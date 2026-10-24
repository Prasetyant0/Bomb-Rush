// Escrow glue tests: roomKey derivation, resultHash wiring on match:finished,
// deposit-confirm rejection/idempotency, chain-disabled mode, settlement states.
// No live chain: the gateway and settlement chain are fakes.
import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { Server as IOServer } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import type { Address, Hex } from 'viem';
import { PROTOCOL_VERSION, GAME_RULES } from '@bomb-rush/shared';
import { RoomStore } from '../src/game/store.js';
import { SessionRegistry } from '../src/net/sessions.js';
import { registerRoutes } from '../src/api/routes.js';
import { attachSocketHandlers } from '../src/net/socketAdapter.js';
import { deriveRoomKey, normalizeWallet, generateRoomNonce } from '../src/escrow/roomKey.js';
import { buildResultCommitment } from '../src/escrow/result.js';
import { settleMatch, type SettlementChain } from '../src/escrow/settlement.js';
import type { EscrowGateway } from '../src/escrow/gateway.js';

const HOST = '0x00000000000000000000000000000000000000B1' as const;
const P1 = '0x00000000000000000000000000000000000000B2' as const;
const P2 = '0x00000000000000000000000000000000000000B3' as const;
const TX = `0x${'cd'.repeat(32)}` as Hex;

const timers = { set: (cb: () => void, ms: number) => setTimeout(cb, ms), clear: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };

function makeStore(overrides: Partial<ConstructorParameters<typeof RoomStore>[0]> = {}) {
  return new RoomStore({ clock: { now: () => Date.now() }, timers, ...overrides });
}

/** Fake gateway: records what it was asked to verify. */
function fakeGateway(opts: {
  verify?: EscrowGateway['verifyDeposit'];
  readRoom?: EscrowGateway['readRoom'];
  bounds?: { minWei: bigint; maxWei: bigint };
} = {}): EscrowGateway & { calls: Array<{ roomKey: Hex; player: Address; amountWei: bigint }>; reads: Hex[] } {
  const calls: Array<{ roomKey: Hex; player: Address; amountWei: bigint }> = [];
  const reads: Hex[] = [];
  return {
    enabled: true,
    calls,
    reads,
    async readRoom(roomKey) {
      reads.push(roomKey);
      return opts.readRoom
        ? opts.readRoom(roomKey)
        : { status: 'FUNDING' as const, entryWei: 10n ** 15n, host: HOST.toLowerCase() };
    },
    async entryBounds() {
      return opts.bounds ?? { minWei: 10n ** 15n, maxWei: 10n ** 19n };
    },
    async verifyDeposit(txHash, expected) {
      calls.push({ roomKey: expected.roomKey, player: expected.player, amountWei: expected.amountWei });
      if (opts.verify) return opts.verify(txHash, expected);
      return {
        ok: true,
        txHash,
        logIndex: 0,
        blockNumber: 1n,
        roomKey: expected.roomKey,
        player: expected.player,
        amountWei: expected.amountWei,
      };
    },
  };
}

/**
 * Room key the "host" claims to have created on chain. The server no longer
 * derives keys, so tests supply one the same way the frontend would.
 */
const CLIENT_KEY = `0x${'7e'.repeat(32)}` as Hex;
const OTHER_CLIENT_KEY = `0x${'8f'.repeat(32)}` as Hex;

describe('roomKey derivation', () => {
  it('is deterministic for identical inputs', () => {
    const input = { chainId: 10_143, nonce: 42n, hostAddress: HOST };
    expect(deriveRoomKey(input)).toBe(deriveRoomKey(input));
  });

  it('is a 32-byte hex string', () => {
    const key = deriveRoomKey({ chainId: 10_143, nonce: 1n, hostAddress: HOST });
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes with nonce, chainId and host', () => {
    const base = { chainId: 10_143, nonce: 1n, hostAddress: HOST };
    expect(deriveRoomKey(base)).not.toBe(deriveRoomKey({ ...base, nonce: 2n }));
    expect(deriveRoomKey(base)).not.toBe(deriveRoomKey({ ...base, chainId: 10_144 }));
    expect(deriveRoomKey(base)).not.toBe(deriveRoomKey({ ...base, hostAddress: P1 }));
  });

  it('rejects an invalid host address instead of hashing garbage', () => {
    expect(() => deriveRoomKey({ chainId: 10_143, nonce: 1n, hostAddress: '0xnot-an-address' })).toThrow();
  });

  it('generated nonces differ', () => {
    expect(generateRoomNonce()).not.toBe(generateRoomNonce());
  });

  it('normalizes wallets to lowercase and rejects junk', () => {
    expect(normalizeWallet(HOST.toUpperCase().replace('0X', '0x'))).toBe(HOST.toLowerCase());
    expect(normalizeWallet('nope')).toBeNull();
    expect(normalizeWallet(42)).toBeNull();
  });
});

describe('room creation and wallet seats', () => {
  it('demo room (no host wallet, no roomKey) has roomKey null', async () => {
    const store = makeStore();
    const r = await store.createRoom('h', '1000000000000000', false);
    expect(store.getRoom(r.roomId!)!.roomKey).toBeNull();
    expect(store.roomState(r.roomId!)!.roomKey).toBeNull();
    store.stop();
  });

  it('accepts a client-supplied roomKey and stores it verbatim (lowercase)', async () => {
    const store = makeStore({ escrowGateway: fakeGateway() });
    const r = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(r.errors).toEqual([]);
    const room = store.getRoom(r.roomId!)!;
    expect(room.roomKey).toBe(CLIENT_KEY);
    expect(store.roomState(r.roomId!)!.roomKey).toBe(CLIENT_KEY);
    // The host seat carries the wallet; the key is NOT re-derived from it.
    expect(store.roomState(r.roomId!)!.participants[0].walletAddress).toBe(HOST.toLowerCase());
    expect(room.roomKey).not.toBe(deriveRoomKey({ chainId: 10_143, nonce: 1n, hostAddress: HOST }));
    store.stop();
  });

  it('chain-disabled room stores the key as UNVERIFIED (escrowStatus NONE)', async () => {
    const store = makeStore({ escrowGateway: null });
    const r = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(r.errors).toEqual([]);
    const room = store.getRoom(r.roomId!)!;
    expect(room.roomKey).toBe(CLIENT_KEY);
    expect(room.escrowStatus).toBe('NONE');
    store.stop();
  });

  it('rejects a roomKey whose on-chain host is a different wallet', async () => {
    const gateway = fakeGateway({
      readRoom: async () => ({ status: 'FUNDING' as const, entryWei: 10n ** 15n, host: P2.toLowerCase() }),
    });
    const store = makeStore({ escrowGateway: gateway });
    const r = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(r.errors[0].code).toBe('BAD_PAYLOAD');
    expect(r.errors[0].message).toContain('host');
    expect(r.roomId).toBeUndefined();
    store.stop();
  });

  it('rejects a roomKey that does not exist on chain (status NONE)', async () => {
    const gateway = fakeGateway({
      readRoom: async () => ({ status: 'NONE' as const, entryWei: 0n, host: '0x0000000000000000000000000000000000000000' }),
    });
    const store = makeStore({ escrowGateway: gateway });
    const r = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(r.errors[0].message).toContain('does not exist');
    store.stop();
  });

  it('rejects a roomKey already bound to a different server room', async () => {
    const store = makeStore({ escrowGateway: fakeGateway() });
    const first = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(first.errors).toEqual([]);
    const second = await store.createRoom('h2', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(second.errors[0].code).toBe('BAD_PAYLOAD');
    expect(second.errors[0].message).toContain('already bound');
    expect(second.roomId).toBeUndefined();
    store.stop();
  });

  it('rejects a roomKey whose entry does not match the escrow room', async () => {
    const gateway = fakeGateway({
      readRoom: async () => ({ status: 'FUNDING' as const, entryWei: 5n * 10n ** 15n, host: HOST.toLowerCase() }),
    });
    const store = makeStore({ escrowGateway: gateway });
    const r = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    expect(r.errors[0].code).toBe('BAD_PAYLOAD');
    expect(r.errors[0].message).toContain('Entry');
    store.stop();
  });

  it('rejects a roomKey without a host wallet, and an unverified key is never marked FUNDED', async () => {
    const store = makeStore({ escrowGateway: fakeGateway() });
    const noWallet = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', null, CLIENT_KEY);
    expect(noWallet.errors[0].code).toBe('BAD_PAYLOAD');

    const ok = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST, CLIENT_KEY);
    // Verified against a FUNDING room: mirror the chain, do not invent FUNDED.
    expect(store.getRoom(ok.roomId!)!.escrowStatus).toBe('FUNDING');
    store.stop();
  });

  it('rejects a duplicate wallet in the same room', async () => {
    const store = makeStore();
    const r = await store.createRoom('h', '1000000000000000', false, 'PUBLIC', HOST);
    const first = store.joinRoom(r.roomId!, 'HUMAN', P1);
    expect(first.errors).toEqual([]);
    const dupe = store.joinRoom(r.roomId!, 'HUMAN', P1.toUpperCase().replace('0X', '0x'));
    expect(dupe.errors[0].code).toBe('BAD_STATE');
    store.stop();
  });

  it('rejects a malformed wallet rather than seating a guest', async () => {
    const store = makeStore();
    const r = await store.createRoom('h', '1000000000000000', false);
    const res = store.joinRoom(r.roomId!, 'HUMAN', '0x1234');
    expect(res.errors[0].code).toBe('BAD_PAYLOAD');
    store.stop();
  });
});

describe('REST: wallet plumbing and deposit-confirm', () => {
  async function harness(gateway: EscrowGateway | null) {
    const app = Fastify({ logger: false });
    const store = makeStore({ escrowGateway: gateway });
    registerRoutes(app, store);
    return { app, store };
  }

  it('GET /api/rooms/:roomId exposes roomKey and participant wallets', async () => {
    const { app, store } = await harness(fakeGateway());
    const created = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', hostWalletAddress: HOST, roomKey: CLIENT_KEY },
    })).json();
    await app.inject({ method: 'POST', url: `/api/rooms/${created.roomId}/join`, payload: { kind: 'HUMAN', walletAddress: P1 } });
    const room = (await app.inject({ method: 'GET', url: `/api/rooms/${created.roomId}` })).json().room;
    expect(created.roomKey).toBe(CLIENT_KEY);
    expect(room.roomKey).toBe(CLIENT_KEY);
    expect(room.participants.map((p: any) => p.walletAddress)).toEqual([HOST.toLowerCase(), P1.toLowerCase()]);
    await app.close(); store.stop();
  });

  it('join rejects an invalid wallet with 400', async () => {
    const { app, store } = await harness(null);
    const c = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000' } })).json();
    const r = await app.inject({ method: 'POST', url: `/api/rooms/${c.roomId}/join`, payload: { kind: 'HUMAN', walletAddress: '0xdeadbeef' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('BAD_PAYLOAD');
    await app.close(); store.stop();
  });

  it('deposit-confirm verifies against the ROOM key and entry amount, and is idempotent', async () => {
    const gateway = fakeGateway();
    const { app, store } = await harness(gateway);
    const c = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', hostWalletAddress: HOST, roomKey: CLIENT_KEY },
    })).json();
    // The stored key is the CLIENT's key, not a server derivative.
    expect(c.roomKey).toBe(CLIENT_KEY);

    const first = await app.inject({
      method: 'POST', url: `/api/rooms/${c.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: HOST },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().confirmed).toBe(true);
    expect(first.json().idempotent).toBe(false);
    // All five checks: the gateway received the room's own key + entry + player.
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toEqual({
      roomKey: CLIENT_KEY,
      player: HOST.toLowerCase(),
      amountWei: 1000000000000000n,
    });

    // Replay: no second chain read.
    const again = await app.inject({
      method: 'POST', url: `/api/rooms/${c.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: HOST },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().idempotent).toBe(true);
    expect(gateway.calls).toHaveLength(1);

    await app.close(); store.stop();
  });

  it('deposit-confirm rejects a tx whose receipt fails verification (wrong roomKey)', async () => {
    const gateway = fakeGateway({
      verify: async () => ({ ok: false, reason: 'ROOM_KEY_MISMATCH', detail: 'DepositConfirmed roomKey does not match' }),
    });
    const { app, store } = await harness(gateway);
    const c = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', hostWalletAddress: HOST, roomKey: CLIENT_KEY },
    })).json();
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${c.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: HOST },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('ROOM_KEY_MISMATCH');
    // A rejected tx must not be remembered as confirmed.
    const retry = await app.inject({
      method: 'POST', url: `/api/rooms/${c.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: HOST },
    });
    expect(retry.statusCode).toBe(400);
    expect(gateway.calls).toHaveLength(2);
    await app.close(); store.stop();
  });

  it('deposit-confirm rejects a wallet with no seat, and a demo room', async () => {
    const gateway = fakeGateway();
    const { app, store } = await harness(gateway);
    const funded = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', hostWalletAddress: HOST, roomKey: CLIENT_KEY },
    })).json();
    const stranger = await app.inject({
      method: 'POST', url: `/api/rooms/${funded.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: P2 },
    });
    expect(stranger.statusCode).toBe(403);
    expect(gateway.calls).toHaveLength(0);

    const demo = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000' } })).json();
    const noKey = await app.inject({
      method: 'POST', url: `/api/rooms/${demo.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: HOST },
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().message).toContain('roomKey');
    await app.close(); store.stop();
  });

  it('deposit-confirm with the chain disabled fails closed (no fake confirmation)', async () => {
    const { app, store } = await harness(null);
    const c = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', hostWalletAddress: HOST, roomKey: CLIENT_KEY },
    })).json();
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${c.roomId}/deposit-confirm`,
      payload: { txHash: TX, walletAddress: HOST },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('disabled');
    await app.close(); store.stop();
  });
});

describe('result commitment', () => {
  it('is null without a roomKey, a winner wallet, or a winner', async () => {
    const store = makeStore();
    const r = await store.createRoom('h', '1000000000000000', false); // demo: no key
    const room = store.getRoom(r.roomId!)!;
    room.matchId = 'm1';
    room.winnerId = room.participants[0].participantId;
    expect(buildResultCommitment(room)).toEqual({ ok: false, reason: 'room has no roomKey (demo mode)' });

    room.roomKey = deriveRoomKey({ chainId: 10_143, nonce: 1n, hostAddress: HOST });
    // host seat has no wallet in this room
    expect(buildResultCommitment(room)).toEqual({ ok: false, reason: 'winner has no wallet address' });

    room.participants[0].walletAddress = HOST.toLowerCase();
    room.winnerId = null;
    expect(buildResultCommitment(room)).toEqual({ ok: false, reason: 'match has no winner' });

    room.winnerId = room.participants[0].participantId;
    const ok = buildResultCommitment(room);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.commitment.hash).toMatch(/^0x[0-9a-f]{64}$/);
    store.stop();
  });
});

describe('settlement state machine', () => {
  const input = {
    roomKey: deriveRoomKey({ chainId: 10_143, nonce: 1n, hostAddress: HOST }),
    winner: HOST,
    resultHash: `0x${'ab'.repeat(32)}` as Hex,
  };

  function chain(overrides: Partial<SettlementChain> = {}): SettlementChain {
    return {
      settle: async () => ({ txHash: `0x${'01'.repeat(32)}` as Hex }),
      payout: async () => ({ txHash: `0x${'02'.repeat(32)}` as Hex }),
      ...overrides,
    };
  }

  it('emits CONFIRMED/PAID only after both receipts succeed', async () => {
    const seen: string[] = [];
    const final = await settleMatch(input, (s) => seen.push(s.state), chain());
    expect(seen).toEqual(['SETTLING', 'CONFIRMED', 'CONFIRMED']);
    expect(final.state).toBe('CONFIRMED');
    if (final.state === 'CONFIRMED') expect(final.payoutState).toBe('PAID');
  });

  it('settle failure emits FAILED and never a tx hash', async () => {
    const events: any[] = [];
    const final = await settleMatch(input, (s) => events.push(s), chain({ settle: async () => { throw new Error('reverted'); } }));
    expect(final.state).toBe('FAILED');
    expect(events.some((e) => e.state === 'CONFIRMED')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('txHash');
  });

  it('payout failure leaves the settlement CONFIRMED and the prize CLAIMABLE (never PAID)', async () => {
    const events: any[] = [];
    const final = await settleMatch(input, (s) => events.push(s), chain({ payout: async () => { throw new Error('out of gas'); } }));
    expect(final.state).toBe('CONFIRMED');
    if (final.state === 'CONFIRMED') {
      expect(final.payoutState).toBe('CLAIMABLE');
      expect(final.reason).toContain('payout');
    }
    expect(events.some((e) => e.payoutState === 'PAID')).toBe(false);
  });
});

describe('socket: chain settlement is attempted only with a real commitment', () => {
  async function harness(settlementChain: SettlementChain | null) {
    const app = Fastify({ logger: false });
    const store = makeStore();
    const sessions = new SessionRegistry(store);
    registerRoutes(app, store);
    const sio = new IOServer(app.server, { cors: { origin: true } });
    const stop = attachSocketHandlers(sio, store, sessions, { settlementChain });
    const url = await app.listen({ port: 0, host: '127.0.0.1' }).then(
      () => `http://127.0.0.1:${(app.server.address() as any).port}`,
    );
    return { app, store, sio, stop, url };
  }

  async function runMatch(app: any, store: RoomStore, url: string, funded: boolean) {
    const created = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', ...(funded ? { hostWalletAddress: HOST, roomKey: CLIENT_KEY } : {}) },
    })).json();
    const wallets = funded ? [P1, P2] : [null, null];
    for (const w of wallets) {
      await app.inject({
        method: 'POST', url: `/api/rooms/${created.roomId}/join`,
        payload: w ? { walletAddress: w } : {},
      });
    }
    const room = store.getRoom(created.roomId)!;
    const client = Client(url, { auth: { eventVersion: PROTOCOL_VERSION } });
    await new Promise<void>((r) => client.on('connect', () => r()));
    const statuses: any[] = [];
    client.on('chain:status', (s) => statuses.push(s));
    client.emit('room:subscribe', { roomId: created.roomId, sessionToken: created.sessionToken });
    await new Promise((r) => setTimeout(r, 120));
    for (const p of room.participants) p.ready = true;
    room.roomStatus = 'COUNTDOWN';
    room.countdownStartsAt = Date.now() - GAME_RULES.LOBBY_COUNTDOWN_MS - 1;
    store.tickNow();
    const winner = room.participants[0];
    room.participants.forEach((p) => { if (p.participantId !== winner.participantId) p.alive = false; });
    room.bombHolderId = room.participants[1].participantId;
    room.bombExpiresAt = Date.now() - 1;
    store.tickNow();
    await new Promise((r) => setTimeout(r, 300));
    client.disconnect();
    return { room, statuses };
  }

  it('funded room settles then pays out and reports CONFIRMED', async () => {
    const settleCalls: any[] = [];
    const chain: SettlementChain = {
      settle: async (roomKey, winner, hash) => {
        settleCalls.push({ roomKey, winner, hash });
        return { txHash: `0x${'01'.repeat(32)}` as Hex };
      },
      payout: async () => ({ txHash: `0x${'02'.repeat(32)}` as Hex }),
    };
    const h = await harness(chain);
    const { room, statuses } = await runMatch(h.app, h.store, h.url, true);
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0].roomKey).toBe(room.roomKey);
    const winner = room.participants.find((p) => p.participantId === room.winnerId)!;
    expect(settleCalls[0].winner).toBe(winner.walletAddress);
    expect(settleCalls[0].hash).toMatch(/^0x[0-9a-f]{64}$/);
    const last = statuses.at(-1);
    expect(last.state).toBe('CONFIRMED');
    expect(last.payoutState).toBe('PAID');
    expect(last.txHash).toBe(`0x${'01'.repeat(32)}`);
    expect(room.escrowStatus).toBe('SETTLED');
    h.stop(); h.sio.close(); await h.app.close(); h.store.stop();
  }, 20_000);

  it('demo room (no roomKey) never attempts settlement', async () => {
    let called = 0;
    const chain: SettlementChain = {
      settle: async () => { called++; return { txHash: `0x${'01'.repeat(32)}` as Hex }; },
      payout: async () => { called++; return { txHash: `0x${'02'.repeat(32)}` as Hex }; },
    };
    const h = await harness(chain);
    await runMatch(h.app, h.store, h.url, false);
    expect(called).toBe(0);
    h.stop(); h.sio.close(); await h.app.close(); h.store.stop();
  }, 20_000);

  it('settle failure keeps the off-chain result and emits FAILED', async () => {
    const chain: SettlementChain = {
      settle: async () => { throw new Error('insufficient funds'); },
      payout: async () => ({ txHash: `0x${'02'.repeat(32)}` as Hex }),
    };
    const h = await harness(chain);
    const { room, statuses } = await runMatch(h.app, h.store, h.url, true);
    expect(room.roomStatus).toBe('FINISHED');
    expect(room.winnerId).toBeTruthy();
    const failed = statuses.find((s) => s.state === 'FAILED');
    expect(failed).toBeTruthy();
    expect(failed.reason).toContain('insufficient funds');
    expect(statuses.some((s) => s.state === 'CONFIRMED')).toBe(false);
    expect(room.escrowStatus).not.toBe('SETTLED');
    h.stop(); h.sio.close(); await h.app.close(); h.store.stop();
  }, 20_000);
});

describe('socket: match:finished carries a real resultHash', () => {
  const app = Fastify({ logger: false });
  const store = makeStore();
  const sessions = new SessionRegistry(store);
  registerRoutes(app, store);
  const sio = new IOServer(app.server, { cors: { origin: true } });
  // No settlement chain: this test is about the hash only.
  const stop = attachSocketHandlers(sio, store, sessions, { settlementChain: null });
  let url = '';
  const sockets: ClientSocket[] = [];

  afterAll(async () => {
    stop();
    sockets.forEach((s) => s.disconnect());
    sio.close();
    await app.close();
    store.stop();
  });

  async function connect(): Promise<ClientSocket> {
    url ||= await app.listen({ port: 0, host: '127.0.0.1' }).then(() => `http://127.0.0.1:${(app.server.address() as any).port}`);
    return new Promise((resolve) => {
      const c = Client(url, { auth: { eventVersion: PROTOCOL_VERSION } });
      c.on('connect', () => resolve(c));
      sockets.push(c);
    });
  }

  it('a finished match with wallets emits a non-placeholder hash; without wallets it emits null', async () => {
    // Funded room: host + 2 joins all carry wallets.
    const created = (await app.inject({
      method: 'POST', url: '/api/rooms',
      payload: { virtualDemoEntryWei: '1000000000000000', hostWalletAddress: HOST, roomKey: CLIENT_KEY },
    })).json();
    const j1 = (await app.inject({ method: 'POST', url: `/api/rooms/${created.roomId}/join`, payload: { walletAddress: P1 } })).json();
    const j2 = (await app.inject({ method: 'POST', url: `/api/rooms/${created.roomId}/join`, payload: { walletAddress: P2 } })).json();

    const room = store.getRoom(created.roomId)!;
    const sock = await connect();
    const tokens = [created.sessionToken, j1.sessionToken, j2.sessionToken];
    for (const t of tokens) {
      sock.emit('room:subscribe', { roomId: created.roomId, sessionToken: t });
    }
    await new Promise((r) => setTimeout(r, 150));

    // Drive the room to LIVE, then eliminate everyone but one player.
    const ids = room.participants.map((p) => p.participantId);
    for (const id of ids) { const p = room.participants.find((x) => x.participantId === id)!; p.ready = true; }
    room.roomStatus = 'COUNTDOWN';
    room.countdownStartsAt = Date.now() - GAME_RULES.LOBBY_COUNTDOWN_MS - 1;
    store.tickNow();
    expect(room.roomStatus).toBe('LIVE');

    const winner = room.participants[0];
    room.participants.forEach((p) => { if (p.participantId !== winner.participantId) p.alive = false; });
    room.bombHolderId = room.participants[1].participantId;
    room.bombExpiresAt = Date.now() - 1;
    const finished = new Promise<any>((r) => sock.once('match:finished', r));
    store.tickNow(); // explosion → one survivor → FINISHED
    const evt = await Promise.race([
      finished,
      new Promise((_, rej) => setTimeout(() => rej(new Error('match:finished hang')), 3000)),
    ]);

    expect(evt.winnerId).toBe(winner.participantId);
    expect(evt.resultHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evt.resultHash).not.toBe('0xplaceholder');

    // And it is exactly the canonical hash over sorted participant ids.
    const { resultHash } = await import('../src/chain/resultHash.js');
    expect(evt.resultHash).toBe(resultHash({
      roomKey: room.roomKey as Hex,
      matchId: room.matchId!,
      participantIds: room.participants.map((p) => p.participantId),
      winner: (winner.walletAddress as Address),
    }));

    // Demo room: no wallets → resultHash must be null, never a fake value.
    const demo = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { virtualDemoEntryWei: '1000000000000000' } })).json();
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: `/api/rooms/${demo.roomId}/join`, payload: {} });
    const demoRoom = store.getRoom(demo.roomId)!;
    const demoEvents: any[] = [];
    // Capture the broadcast on the store callback path via a listener socket.
    const demoClient = await connect();
    demoClient.on('match:finished', (d) => demoEvents.push(d));
    demoClient.emit('room:subscribe', { roomId: demo.roomId, sessionToken: demo.sessionToken });
    await new Promise((r) => setTimeout(r, 100));

    for (const p of demoRoom.participants) p.ready = true;
    demoRoom.roomStatus = 'COUNTDOWN';
    demoRoom.countdownStartsAt = Date.now() - GAME_RULES.LOBBY_COUNTDOWN_MS - 1;
    store.tickNow();
    const demoWinner = demoRoom.participants[0];
    demoRoom.participants.forEach((p) => { if (p.participantId !== demoWinner.participantId) p.alive = false; });
    demoRoom.bombHolderId = demoRoom.participants[1].participantId;
    demoRoom.bombExpiresAt = Date.now() - 1;
    store.tickNow();
    await new Promise((r) => setTimeout(r, 150));
    expect(demoEvents.length).toBe(1);
    expect(demoEvents[0].resultHash).toBeNull();
  }, 20_000);
});

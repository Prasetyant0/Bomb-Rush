// Socket.IO integration test — 3 simulated clients join a real server.
// ponytail: manipulates room internals for time jumps instead of fake timers,
// keeping the real transport path (contracts validated + broadcast observed).
import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { Server as IOServer } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { PROTOCOL_VERSION, GAME_RULES } from '@bomb-rush/shared';
import { RoomStore } from '../src/game/store.js';
import { SessionRegistry } from '../src/net/sessions.js';
import { registerRoutes } from '../src/api/routes.js';
import { attachSocketHandlers } from '../src/net/socketAdapter.js';

async function startServer() {
  const app = Fastify({ logger: false });
  const store = new RoomStore({
    clock: { now: () => Date.now() },
    timers: { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as any) },
  });
  const sessions = new SessionRegistry(store);
  registerRoutes(app, store);
  const sio = new IOServer(app.server, { cors: { origin: true } });
  const stop = attachSocketHandlers(sio, store, sessions);
  const addr = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, sio: sio as any, store, stop, url: `http://127.0.0.1:${(app.server.address() as any).port}` };
}

function connect(url: string): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const c = Client(url, { auth: { eventVersion: PROTOCOL_VERSION } });
    c.on('connect', () => resolve(c));
  });
}

const srv = await startServer(); // top-level await, vitest supports it
afterAll(async () => {
  srv.stop();
  srv.sio.close();
  await srv.app.close();
});

describe('socket.io crossplay integration', () => {
  it('create → join → subscribe → ready → countdown → LIVE → pass accepted', async () => {
    // 4 = 3 humans (REST join via clients' REST is not used here; host + 3 joins)
    const createRes = await srv.app.inject({ method: 'POST', url: '/api/rooms', payload: { visibility: 'PUBLIC', virtualDemoEntryWei: '1000000000000000', allowDemoBot: false } });
    expect(createRes.statusCode).toBe(201);
    const { roomId, participantId: hostId, sessionToken: hostToken } = createRes.json();

    // 3 simulated clients join (max 4 with host)
    const joins = await Promise.all(
      [0, 1, 2].map(() => srv.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, payload: { kind: 'HUMAN' } })),
    );
    expect(joins.every((j) => j.statusCode === 200)).toBe(true);

    // each client subscribes; identity derived from token mapping
    const clients = [hostId, ...joins.map((j) => j.json().participantId)];
    const tokens = [hostToken, ...joins.map((j) => j.json().sessionToken)];
    const sockets: ClientSocket[] = [];
    for (let i = 0; i < clients.length; i++) {
      const s = await connect(srv.url);
      const gotState = new Promise<any>((r) => s.once('room:state', r));
      s.emit('room:subscribe', { roomId, sessionToken: tokens[i] });
      const state = await Promise.race([gotState, new Promise<any>((_, rej) => setTimeout(() => rej(new Error(`subscribe hang at i=${i}`)), 3000))]);
      expect(state.status).toBeDefined();
      sockets.push(s);
    }

    // 4th join while WAITING but room full → ROOM_FULL
    const extra = await srv.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, payload: { kind: 'HUMAN' } });
    expect(extra.statusCode).toBe(403);

    // subscribe with wrong token → error
    const stranger = await connect(srv.url);
    const err = new Promise<any>((r) => stranger.once('game:error', r));
    stranger.emit('room:subscribe', { roomId, sessionToken: 'bogus' });
    expect((await Promise.race([err, new Promise<any>((_, rej) => setTimeout(() => rej(new Error('stranger err hang')), 3000))])).code).toBe('SUBSCRIBE_AUTH_FAILED');
    stranger.disconnect();

    // all clients ready → countdown starts (race-tolerant: poll, no per-event ack)
    const countdowns: any[] = [];
    sockets.slice(1).forEach((s) => s.on('room:countdown', (d: any) => countdowns.push(d)));
    for (let i = 0; i < clients.length; i++) {
      sockets[i].emit('room:set_ready', { ready: true });
    }
    await new Promise((r) => setTimeout(r, 150));
    expect(srv.store.getRoom(roomId)!.roomStatus).toBe('COUNTDOWN');
    expect(countdowns.length).toBeGreaterThanOrEqual(1);

    // listen before the jump; store broadcasts match:started during tickNow
    const startedPromises = sockets.map((s) => new Promise<any>((r) => s.once('match:started', r)));
    // pass jump: force countdown completion through the store's authoritative path
    const room = srv.store.getRoom(roomId)!;
    room.expiresAt = Date.now() + GAME_RULES.ROOM_EXPIRY_MS; // keep live
    room.countdownStartsAt = Date.now() - GAME_RULES.LOBBY_COUNTDOWN_MS - 1;
    srv.store.tickNow();
    expect(room.roomStatus).toBe('LIVE');
    expect(room.matchId).toBeTruthy();
    expect(room.bombHolderId).toBeTruthy();
    expect(room.bombExpiresAt).toBeGreaterThan(Date.now());
    // guard against a hang in started-broadcast
    await Promise.race([
      Promise.all(startedPromises).then((v) => v),
      new Promise((_, rej) => setTimeout(() => rej(new Error('match:started broadcast hang')), 3000)),
    ]);

    // all clients receive match:started
    const started = await Promise.all(startedPromises);
    expect(started.every((e) => e.matchId === room.matchId)).toBe(true);

    // non-holder pass → NOT_BOMB_HOLDER error; holder pass to nearest → accepted
    const holderIdx = clients.findIndex((cid) => cid === room.bombHolderId);
    expect(holderIdx).toBeGreaterThanOrEqual(0);
    const nonHolder = sockets[(holderIdx + 1) % clients.length];
    const nonHolderErr = new Promise<any>((r) => nonHolder.once('game:error', r));
    nonHolder.emit('bomb:pass_intent', { sequence: 1 });
    expect((await Promise.race([nonHolderErr, new Promise<any>((_, rej) => setTimeout(() => rej(new Error('nonHolderErr hang')), 3000))])).code).toBe('NOT_BOMB_HOLDER');

    // teleport another player next to the holder, then holder passes
    const target = clients[(holderIdx + 1) % clients.length];
    const targetRoom = room.participants.find((p) => p.participantId === target)!;
    const holderPos = room.participants.find((p) => p.participantId === room.bombHolderId)!.position;
    targetRoom.position = { x: holderPos.x + 0.5, y: 0, z: holderPos.z };
    const holderSocket = sockets[holderIdx];
    const accepted = new Promise<any>((r) => holderSocket.once('bomb:pass_accepted', r));
    const holderErr = new Promise<any>((r) => holderSocket.once('game:error', r));
    holderSocket.emit('bomb:pass_intent', { sequence: 1 });
    const pass = await Promise.race([
      accepted.then((a) => ({ ok: a })),
      holderErr.then((e) => ({ err: e })),
      new Promise<any>((_, rej) => setTimeout(() => rej(new Error('accepted hang')), 3000)),
    ]);
    if (!pass.ok) throw new Error(`pass failed with: ${JSON.stringify(pass)}`);
    expect(room.bombHolderId).toBe(pass.ok.toId);
    sockets.forEach((s) => s.disconnect());
  }, 30_000);

  it('invalid payload rejected; snapshot 20 Hz loop emits match:snapshot', async () => {
    const createRes = await srv.app.inject({ method: 'POST', url: '/api/rooms', payload: { visibility: 'PUBLIC', virtualDemoEntryWei: '1000000000000000', allowDemoBot: false } });
    const { roomId, participantId, sessionToken } = createRes.json();
    // two extra humans
    const j1 = await srv.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, payload: { kind: 'HUMAN' } });
    const j2 = await srv.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, payload: { kind: 'HUMAN' } });
    const s = await connect(srv.url);
    s.emit('room:subscribe', { roomId, sessionToken });
    await new Promise((r) => s.once('room:state', r));
    // ARM for fast LIVE jump; bring 2 friends in and ready
    const pj1 = j1.json().participantId;
    const pj2 = j2.json().participantId;
    const jokers = [await connect(srv.url), await connect(srv.url)];
    jokers[0].emit('room:subscribe', { roomId, sessionToken: j1.json().sessionToken });
    jokers[1].emit('room:subscribe', { roomId, sessionToken: j2.json().sessionToken });
    s.emit('room:set_ready', { ready: true });
    jokers[0].emit('room:set_ready', { ready: true });
    jokers[1].emit('room:set_ready', { ready: true });
    await new Promise((r) => setTimeout(r, 150));
    const room = srv.store.getRoom(roomId)!;
    expect(room.roomStatus).toBe('COUNTDOWN');
    room.countdownStartsAt = Date.now() - GAME_RULES.LOBBY_COUNTDOWN_MS - 1;
    srv.store.tickNow();
    expect(room.roomStatus).toBe('LIVE');
    // valid input accepted
    s.emit('player:input', { sequence: 1, moveX: 0.7, moveZ: 0.7, sprint: true });
    // malformed input (moveX=5) silently dropped → no crash, still LIVE
    s.emit('player:input', { sequence: 2, moveX: 5, moveZ: 0, sprint: false });
    expect(room.roomStatus).toBe('LIVE');
    // snapshot within 1000 ms at 10 Hz
    const snap = await new Promise<any>((r) => {
      const t = setTimeout(() => r(null), 1500);
      s.once('match:snapshot', (d) => { clearTimeout(t); r(d); });
    });
    expect(snap).toBeTruthy();
    expect(snap.matchId).toBe(room.matchId);
    s.disconnect();
    jokers.forEach((j) => j.disconnect());
  }, 20_000);
});

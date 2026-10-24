// REST API — Fastify routes matching API_CONTRACT.md §2.
// No public REST route permits setting winner or bypassing event contracts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GAME_RULES, RULE_VERSION, ENTRY_MIN_WEI, ENTRY_MAX_WEI } from '@bomb-rush/shared';
import type { RoomStore } from '../game/store.js';
import { normalizeWallet } from '../escrow/roomKey.js';

/** Accepts lowercase, uppercase or a correct EIP-55 checksum. */
const walletSchema = z.string().refine((s) => normalizeWallet(s) !== null, 'must be a valid EVM address');

const createRoomSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  /**
   * The stake per seat, in wei, as a decimal string.
   *
   * This MUST be the same window the contract enforces — `entryBounds()` on
   * the deployed escrow returns 1e15..1e16. It used to say 1e16..1e19 (a
   * leftover from the virtual-credit era), which meant the only value the
   * frontend could send that satisfied BOTH the contract and this schema was
   * exactly 0.01 MON. Every other preset was rejected, so the create button
   * stayed disabled and no funded room could ever be made.
   *
   * The contract is the authority; this mirrors it. If they diverge, the
   * mismatch surfaces as a rejected room rather than a failed deposit, but the
   * right fix is always to read `entryBounds()` and match it here.
   */
  virtualDemoEntryWei: z
    .string()
    .regex(/^[0-9]{1,22}$/, 'nonneg integer wei string')
    .refine((s) => {
      const n = BigInt(s);
      return n >= ENTRY_MIN_WEI && n <= ENTRY_MAX_WEI;
    }, 'entry must be between ENTRY_MIN_WEI and ENTRY_MAX_WEI (0.001–0.01 test MON)'),
  allowDemoBot: z.boolean().default(false),
  /**
   * Host wallet + the escrow roomKey the HOST created on-chain. The roomKey is
   * verified server-side against getRoom/entryBounds before it is accepted;
   * it is never derived here.
   */
  hostWalletAddress: walletSchema.optional(),
  roomKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a bytes32 hex string').optional(),
});

export interface ChainHealth {
  enabled: boolean;
  detail: string;
  /** Result of the boot selfCheck; null until it has run (or if disabled). */
  selfCheck: null | { ok: boolean; chainId?: number; hasSettlerRole?: boolean; error?: string };
}

export function registerRoutes(app: FastifyInstance, store: RoomStore, chainHealth?: () => ChainHealth) {
  app.get('/health', async () => ({
    ok: true,
    version: RULE_VERSION,
    time: new Date().toISOString(),
    rules: RULE_VERSION,
    chain: chainHealth ? chainHealth() : undefined,
  }));

  // Public room summaries only (API_CONTRACT §2): PRIVATE rooms stay out of the browser.
  app.get('/api/rooms', async (req) => {
    const query = z.object({ status: z.string().optional() }).parse(req.query ?? {});
    const rooms = store.listRooms().filter((r) => r.visibility === 'PUBLIC');
    const filtered = query.status ? rooms.filter((r) => r.status === query.status) : rooms;
    return { rooms: filtered };
  });

  app.post('/api/rooms', async (req, reply) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'BAD_PAYLOAD',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    // host identity: MVP uses a server-issued sessionId cookie substitute.
    // ponytail: guest-mode session, SIWE/wallet auth deferred until Dev C lands wagmi.
    const hostSessionId = crypto.randomUUID();
    const created = await store.createRoom(
      hostSessionId,
      parsed.data.virtualDemoEntryWei,
      parsed.data.allowDemoBot,
      parsed.data.visibility,
      parsed.data.hostWalletAddress ?? null,
      parsed.data.roomKey ?? null,
    );
    if (created.errors.length > 0) {
      const code = created.errors[0].code;
      const status = code === 'BAD_STATE' ? 502 : 400;
      return reply.code(status).send({ error: code, message: created.errors[0].message });
    }
    return reply.code(201).send({
      roomId: created.roomId,
      code: created.code,
      participantId: created.participantId,
      sessionToken: created.sessionToken,
      status: 'WAITING',
      visibility: created.visibility,
      hostSessionId: created.hostSessionId,
      roomKey: created.roomKey ?? null,
    });
  });

  app.post('/api/rooms/:roomId/join', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const body = z.object({
      kind: z.enum(['HUMAN', 'DEMO_BOT']).default('HUMAN'),
      walletAddress: walletSchema.optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: 'BAD_PAYLOAD',
        detail: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const res = store.joinRoom(roomId, body.data.kind, body.data.walletAddress ?? null);
    if (res.errors.length > 0) {
      const code = res.errors[0].code;
      const status = code === 'ROOM_FULL' ? 403 : code === 'ROOM_NOT_JOINABLE' ? 409 : 400;
      return reply.code(status).send({ error: code, message: res.errors[0].message });
    }
    return reply.code(200).send({
      participantId: res.participantId,
      sessionToken: res.sessionToken,
      room: store.roomState(roomId),
    });
  });

  // Deposit confirmation: verify the on-chain deposit receipt for THIS room,
  // then mirror the escrow status. Idempotent per txHash.
  app.post('/api/rooms/:roomId/deposit-confirm', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const body = z.object({
      txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte 0x-prefixed hash'),
      walletAddress: walletSchema,
    }).safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: 'BAD_PAYLOAD',
        detail: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const out = await store.confirmDeposit(roomId, body.data);
    if (out.errors.length > 0) {
      const code = out.errors[0].code;
      const status = code === 'ROOM_NOT_JOINABLE' ? 404 : code === 'NOT_IN_ROOM' ? 403 : 400;
      return reply.code(status).send({ error: code, message: out.errors[0].message });
    }
    return {
      confirmed: true,
      idempotent: out.idempotent ?? false,
      escrowStatus: out.escrowStatus,
      room: store.roomState(roomId),
    };
  });

  app.get('/api/rooms/:roomId', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const state = store.roomState(roomId);
    if (!state) return reply.code(404).send({ error: 'ROOM_NOT_JOINABLE', message: 'Room not found.' });
    return { room: state };
  });

  app.post('/api/rooms/:roomId/cancel', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    // Host authorization: participantId proves WHO, sessionToken proves the
    // caller holds that seat (guest-session model, no account system).
    const body = z.object({ participantId: z.string().uuid(), sessionToken: z.string().min(1).max(128) }).safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_PAYLOAD', message: 'participantId and sessionToken required.' });
    }
    const out = store.cancelRoom(roomId, body.data.participantId, body.data.sessionToken);
    if (out.errors.length > 0) {
      const status = out.errors[0].code === 'NOT_HOST' ? 403 : 409;
      return reply.code(status).send({ error: out.errors[0].code, message: out.errors[0].message });
    }
    return { canceled: true };
  });

  app.get('/api/matches/:matchId/result', async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    for (const room of store.allRooms()) {
      if (room.matchId === matchId && room.roomStatus === 'FINISHED') {
        // Chain record state mirrors the escrow status; never a fabricated tx hash.
        return {
          matchId,
          status: room.roomStatus,
          winnerId: room.winnerId,
          virtualPool: room.virtualDemoEntryWei,
          roomKey: room.roomKey,
          chainRecord: {
            state: room.escrowStatus === 'SETTLED' ? ('SETTLED' as const) : ('PENDING' as const),
            escrowStatus: room.escrowStatus,
            explorerUrl: null,
          },
        };
      }
    }
    return reply.code(404).send({ error: 'BAD_STATE', message: 'Match not found or not finished.' });
  });
}

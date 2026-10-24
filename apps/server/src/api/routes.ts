// REST API — Fastify routes matching API_CONTRACT.md §2.
// No public REST route permits setting winner or bypassing event contracts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GAME_RULES } from '@bomb-rush/shared';
import type { RoomStore } from '../game/store.js';

const createRoomSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  // virtualDemoEntryWei: virtual points in 18-dec wei string, 0.01–10 test-MON range
  virtualDemoEntryWei: z
    .string()
    .regex(/^[0-9]{1,22}$/, 'nonneg integer wei string')
    .refine((s) => {
      const n = BigInt(s);
      // 0.01 test MON = 1e16 wei, 10 test MON = 1e19 wei (PRD FR-01)
      return n >= 10n ** 16n && n <= 10n ** 19n;
    }, 'entry must be 0.01–10 test-MON-denominated virtual points'),
  allowDemoBot: z.boolean().default(false),
});

export function registerRoutes(app: FastifyInstance, store: RoomStore) {
  app.get('/health', async () => ({
    ok: true,
    version: '0.3.1',
    time: new Date().toISOString(),
    rules: 'bomb-rush-v0.3',
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
    const { roomId, code, participantId, sessionToken, visibility } = store.createRoom(
      hostSessionId,
      parsed.data.virtualDemoEntryWei,
      parsed.data.allowDemoBot,
      parsed.data.visibility,
    );
    return reply.code(201).send({ roomId, code, participantId, sessionToken, status: 'WAITING', visibility, hostSessionId });
  });

  app.post('/api/rooms/:roomId/join', async (req, reply) => {
    const { roomId } = req.params as { roomId: string };
    const body = z.object({ kind: z.enum(['HUMAN', 'DEMO_BOT']).default('HUMAN') }).safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_PAYLOAD', detail: 'kind must be HUMAN or DEMO_BOT' });
    }
    const res = store.joinRoom(roomId, body.data.kind);
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
        // P0: winner is server-adjudicated; chain record status is PENDING until
        // the Monad testnet recorder lands. Never a fabricated tx hash.
        return {
          matchId,
          status: room.roomStatus,
          winnerId: room.winnerId,
          virtualPool: room.virtualDemoEntryWei,
          chainRecord: { state: 'PENDING' as const, explorerUrl: null },
        };
      }
    }
    return reply.code(404).send({ error: 'BAD_STATE', message: 'Match not found or not finished.' });
  });
}

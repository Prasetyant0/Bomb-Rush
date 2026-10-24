// Socket.IO adapter — validates payloads, maps to domain, broadcasts events.
// All game rules live in game/domain.ts; this file never decides game state.
import type { Server, Socket } from 'socket.io';
import { socketSchemas, PROTOCOL_VERSION, GAME_RULES } from '@bomb-rush/shared';
import type { Hex } from 'viem';
import { RoomStore } from '../game/store.js';
import { SessionRegistry } from './sessions.js';
import { makeTokenBucket, type RateLimiter } from './rateLimit.js';
import { buildResultCommitment } from '../escrow/result.js';
import { settleMatch, type SettlementChain, type ChainStatusEvent } from '../escrow/settlement.js';

const TICK_MS = 1000 / GAME_RULES.SERVER_TICK_HZ; // 50ms server loop
// Snapshot cadence derived from the shared constants: 20 Hz sim / 15 Hz
// snapshots = emit every 4th tick (rounding up so we never exceed the rate).
const SNAPSHOT_TICKS = Math.max(
  1,
  Math.round(GAME_RULES.SERVER_TICK_HZ / GAME_RULES.SNAPSHOT_HZ),
);

export interface SocketAdapterOptions {
  /**
   * Chain settlement boundary. Null = chain disabled: no settlement is
   * attempted and the game behaves exactly as before.
   */
  settlementChain?: SettlementChain | null;
}

export function attachSocketHandlers(
  io: Server,
  store: RoomStore,
  sessions: SessionRegistry,
  options: SocketAdapterOptions = {},
) {
  const settlementChain = options.settlementChain ?? null;
  // One settlement attempt per match, however many times an event fires.
  const settledMatches = new Set<string>();
  // Rate limits key on participantId when the session is known, else socket.id
  // — so reconnecting into a fresh socketId cannot reset the budget.
  const inputLimiter = makeTokenBucket({ eventsPerInterval: GAME_RULES.SERVER_TICK_HZ * 1.5, intervalMs: 1000, maxBurst: 45 }); // 30/s nominal
  const passLimiter = makeTokenBucket({ eventsPerInterval: 2, intervalMs: GAME_RULES.PASS_COOLDOWN_MS, maxBurst: 2 });
  const readyLimiter = makeTokenBucket({ eventsPerInterval: 5, intervalMs: 1000, maxBurst: 5 });
  const snapshotLimiter = makeTokenBucket({ eventsPerInterval: 2, intervalMs: 500, maxBurst: 2 });

  io.on('connection', (socket: Socket) => {
    // Handshake protocol version; reject mismatched clients (API_CONTRACT §5).
    const handshakeVersion = socket.handshake?.auth?.eventVersion as string | undefined;
    if (handshakeVersion !== PROTOCOL_VERSION) {
      socket.emit('game:error', {
        code: 'PROTOCOL_VERSION_MISMATCH',
        message: `Expected eventVersion ${PROTOCOL_VERSION}; got ${handshakeVersion ?? 'none'}.`,
      });
      socket.disconnect(true);
      return;
    }

    // ---- room:subscribe ----
    socket.on('room:subscribe', (raw) => {
      // subscription share budget with ready toggles so churning sockets can't
      // bypass the same limiter.
      if (!readyLimiter.canSend(`subscribe:${socket.id}`)) {
        return sendError(socket, 'RATE_LIMITED', 'Too many subscribe attempts.');
      }
      const parsed = socketSchemas['room:subscribe'].safeParse(raw);
      if (!parsed.success) {
        socket.emit('game:error', { code: 'BAD_PAYLOAD', message: 'Malformed subscribe payload.' });
        return;
      }
      const { roomId, sessionToken } = parsed.data;
      // Identity must already exist (joinRoom minted participantId + token);
      // the client can never pass an unregistered participantId here.
      const known = findParticipantByToken(store, sessionToken);
      if (!known || known.roomId !== roomId) {
        socket.emit('game:error', { code: 'SUBSCRIBE_AUTH_FAILED', message: 'Unknown session token or room mismatch.' });
        return;
      }
      const auth = sessions.authenticate(socket.id, roomId, known.participantId, sessionToken);
      if (auth.errors.length > 0) {
        socket.emit('game:error', { code: 'SUBSCRIBE_AUTH_FAILED', message: auth.errors[0].message });
        return;
      }
      socket.join(`room:${roomId}`);
      // send the subscriber a full room state; broadcast to room as well
      const state = store.roomState(roomId);
      if (state) {
        io.to(`room:${roomId}`).emit('room:state', state);
        if (state.status === 'LIVE') {
          const snap = store.roomSnapshot(roomId);
          if (snap) socket.emit('match:snapshot', snap);
        }
      }
    });

    // ---- room:set_ready ----
    socket.on('room:set_ready', (raw) => {
      const parsed = socketSchemas['room:set_ready'].safeParse(raw);
      if (!parsed.success) return sendError(socket, 'BAD_PAYLOAD', 'Malformed ready payload.');
      const session = sessions.get(socket.id);
      if (!session) return sendError(socket, 'NOT_IN_ROOM', 'Subscribe to a room before setting ready.');
      if (!readyLimiter.canSend(session.participantId)) return sendError(socket, 'RATE_LIMITED', 'Too many ready toggles.');
      const out = store.setReady(session.roomId, session.participantId, parsed.data.ready);
      if ('errors' in out && out.errors.length > 0) {
        sendError(socket, out.errors[0].code, out.errors[0].message);
        return;
      }
      // broadcast room state (this is the authoritative broadcast for lobby UI)
      const state = store.roomState(session.roomId);
      if (state) io.to(`room:${session.roomId}`).emit('room:state', state);
    });

    // ---- player:input (latest-value stream, server authoritative) ----
    socket.on('player:input', (raw) => {
      const parsed = socketSchemas['player:input'].safeParse(raw);
      if (!parsed.success) return; // silently drop malformed input (20-30/s traffic)
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!inputLimiter.canSend(session.participantId)) return; // rate limited: drop, do not respond
      store.applyInput(session.roomId, session.participantId, parsed.data);
    });

    // ---- bomb:pass_intent (edge-trigger) ----
    socket.on('bomb:pass_intent', (raw) => {
      const parsed = socketSchemas['bomb:pass_intent'].safeParse(raw);
      if (!parsed.success) return sendError(socket, 'BAD_PAYLOAD', 'Malformed pass intent.');
      const session = sessions.get(socket.id);
      if (!session) return sendError(socket, 'NOT_IN_ROOM', 'Not subscribed to a room.');
      if (!passLimiter.canSend(session.participantId)) return sendError(socket, 'RATE_LIMITED', 'Too many pass attempts.');
      const out = store.passBomb(session.roomId, session.participantId);
      if ('errors' in out && out.errors.length > 0) {
        sendError(socket, out.errors[0].code, out.errors[0].message);
      }
      // bomb:pass_accepted broadcast is issued in store deps below on success
    });

    // ---- match:request_snapshot ----
    socket.on('match:request_snapshot', (raw) => {
      const parsed = socketSchemas['match:request_snapshot'].safeParse(raw);
      if (!parsed.success) return sendError(socket, 'BAD_PAYLOAD', 'Malformed snapshot request.');
      const session = sessions.get(socket.id);
      if (!session) return sendError(socket, 'NOT_IN_ROOM', 'Not subscribed to a room.');
      if (!snapshotLimiter.canSend(session.participantId)) return sendError(socket, 'RATE_LIMITED', 'Snapshot request rate limited.');
      const room = store.getRoom(session.roomId);
      if (!room || room.matchId !== parsed.data.matchId) return sendError(socket, 'NOT_IN_ROOM', 'Match not found in your room.');
      const snap = store.roomSnapshot(session.roomId);
      if (snap) socket.emit('match:snapshot', snap);
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      store.disconnect(session.roomId, session.participantId);
      sessions.disconnect(socket.id);
      // room:state update for lobby peers
      const state = store.roomState(session.roomId);
      if (state) io.to(`room:${session.roomId}`).emit('room:state', state);
    });
  });

  // Deposit confirmations arrive over REST; mirror the resulting escrow status
  // to everyone in the room so the UI does not have to poll.
  store.setChainStatusCallback((roomId, status) => {
    io.to(`room:${roomId}`).emit('chain:status', status);
  });

  // Wire store events (authoritative decisions) to socket broadcasts.
  store.setEventCallback((roomId, events) => {
    const room = store.getRoom(roomId);
    if (!room) return;
    const roomKey = `room:${roomId}`;
    if (events.roomCountdownStarted) {
      io.to(roomKey).emit('room:countdown', {
        startAtMs: events.roomCountdownStarted.startAtMs,
        serverTimeMs: events.roomCountdownStarted.serverTimeMs,
      });
    }
    if (events.roomCountdownCanceled || events.matchStarted) {
      const state = store.roomState(roomId);
      if (state) io.to(roomKey).emit('room:state', state);
    }
    if (events.matchStarted) {
      io.to(roomKey).emit('match:started', {
        matchId: events.matchStarted.matchId,
        startedAtMs: events.matchStarted.startedAtMs,
      });
    }
    if (events.bombPassAccepted) {
      io.to(roomKey).emit('bomb:pass_accepted', {
        fromId: events.bombPassAccepted.fromId,
        toId: events.bombPassAccepted.toId,
        tick: events.bombPassAccepted.tick,
      });
      const snap = store.roomSnapshot(roomId);
      if (snap) io.to(roomKey).emit('match:snapshot', snap);
    }
    if (events.elimination) {
      io.to(roomKey).emit('match:event', { type: 'ELIMINATE', actorId: events.elimination.eliminatedId, tick: room.tick });
    }
    if (events.matchFinished) {
      io.to(roomKey).emit('match:event', { type: 'RECONNECT', actorId: undefined, tick: room.tick });
      if (events.matchFinished.winnerId) {
        // A hash is emitted ONLY when it can be computed from real inputs
        // (roomKey + winner wallet). Otherwise resultHash is null — never a
        // placeholder, because a fake hash is indistinguishable from a real
        // commitment to any observer.
        const commitment = buildResultCommitment(room);
        io.to(roomKey).emit('match:finished', {
          matchId: events.matchFinished.matchId,
          winnerId: events.matchFinished.winnerId,
          resultHash: commitment.ok ? commitment.commitment.hash : null,
        });

        // P2: settle only with a real commitment, a real chain, and a room key.
        if (commitment.ok && settlementChain && room.roomKey) {
          const matchId = events.matchFinished.matchId;
          if (!settledMatches.has(matchId)) {
            settledMatches.add(matchId);
            const emitStatus = (status: ChainStatusEvent) =>
              io.to(roomKey).emit('chain:status', { ...status, matchId });
            void settleMatch(
              {
                roomKey: room.roomKey as Hex,
                winner: commitment.commitment.winnerWallet,
                resultHash: commitment.commitment.hash,
              },
              emitStatus,
              settlementChain,
            ).then((final) => {
              // Mirror only a chain-backed truth. CONFIRMED means the settle
              // receipt landed, so the escrow status really is SETTLED; a
              // failed payout leaves prizePaid=false, and the event's
              // payoutState:'CLAIMABLE' is what tells the UI it is unclaimed.
              if (final.state === 'CONFIRMED') {
                room.escrowStatus = 'SETTLED';
              }
              const latest = store.roomState(roomId);
              if (latest) io.to(roomKey).emit('room:state', latest);
            }).catch((err) => {
              const reason = err instanceof Error ? err.message : String(err);
              io.to(roomKey).emit('chain:status', { state: 'FAILED', reason, matchId });
            });
          }
        }
      } else {
        io.to(roomKey).emit('match:finished', {
          matchId: events.matchFinished.matchId,
          winnerId: null,
          resultHash: null,
        });
      }
      const state = store.roomState(roomId);
      if (state) io.to(roomKey).emit('room:state', state);
    }
    if (events.roomLapsed) {
      const state = store.roomState(roomId);
      if (state) io.to(roomKey).emit('room:state', state);
    }
  });

  // 20 Hz loop: one global authoritative loop; per-room work stays in the store.
  let lastSnapshot = 0;
  const ticker = setInterval(() => {
    lastSnapshot++;
    for (const room of store.allRooms()) {
      if (room.roomStatus !== 'LIVE') continue;
      store.tickNow(); // authoritative state update + explosion check
    }
    if (lastSnapshot % SNAPSHOT_TICKS === 0) {
      for (const room of store.allRooms()) {
        if (room.roomStatus !== 'LIVE') continue;
        const snap = store.roomSnapshot(room.roomId);
        if (snap) io.to(`room:${room.roomId}`).emit('match:snapshot', snap);
      }
    }
  }, TICK_MS);
  return () => clearInterval(ticker);
}

function sendError(socket: Socket, code: string, message: string) {
  // Never leak internal stack traces; consistent codes only (Phase C).
  socket.emit('game:error', { code, message });
}

function findParticipantByToken(store: RoomStore, sessionToken: string): { roomId: string; participantId: string } | null {
  return store.findParticipantByToken(sessionToken);
}

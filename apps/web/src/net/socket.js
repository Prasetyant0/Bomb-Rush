// net/socket.js — thin Socket.IO client wrapper for the BOMB RUSH server.
//
// Contract source of truth: apps/server/src/net/socketAdapter.ts
//   C→S  room:subscribe           { roomId (uuid), sessionToken }
//   C→S  room:set_ready           { ready: boolean }
//   C→S  player:input             { sequence, moveX, moveZ, sprint }  (strict; ≤30/s)
//   C→S  bomb:pass_intent         { sequence }                        (strict; edge-triggered)
//   C→S  match:request_snapshot   { matchId (uuid) }                  (≤2 / 500 ms)
//   S→C  room:state               RoomPublicState (participantId, kind, ready)
//   S→C  room:countdown           { startAtMs, serverTimeMs }
//   S→C  match:started            { matchId, startedAtMs }            (NO initialHolderId)
//   S→C  match:snapshot           MatchSnapshot (participantId-based)
//   S→C  bomb:pass_accepted       { fromId, toId, tick }              (NO serverTimeMs)
//   S→C  match:event              { type: 'ELIMINATE'|'RECONNECT', actorId?, tick }
//   S→C  match:finished           { matchId, winnerId, resultHash }   (NOT a MatchResult)
//   S→C  chain:status             { state: SETTLING|CONFIRMED|FAILED, txHash?, payoutTxHash? }
//   S→C  game:error               { code, message }                   (NOT room:error)
//
// Handshake auth MUST carry auth.eventVersion === PROTOCOL_VERSION ('0.3');
// the server disconnects mismatched clients on connect.
import { PROTOCOL_VERSION, SOCKET_IO_URL, defaultUrl } from "./protocol.js";

export { defaultUrl };

export const INPUT_HZ = 30;
export const MAX_PASS_INTENTS = 2; // server: 2 per PASS_COOLDOWN_MS (700 ms)

const nowMs = () => Date.now();

/** Minimal emitter (no Node dependency; usable from Node tests and browsers). */
export function createEmitter() {
  const handlers = new Map();
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => this.off(event, fn);
    },
    once(event, fn) {
      const off = this.on(event, (payload) => { off(); fn(payload); });
      return off;
    },
    off(event, fn) {
      handlers.get(event)?.delete(fn);
    },
    emitLocal(event, payload) {
      for (const fn of [...(handlers.get(event) ?? [])]) {
        try { fn(payload); } catch (err) { console.error(`[net] handler for ${event} threw`, err); }
      }
    },
    removeAll() { handlers.clear(); },
  };
}

/**
 * Build a game socket. `socketFactory` exists so tests can inject a fake.
 * @param {object} opts
 * @param {string} [opts.url] - server origin; defaults to same origin
 * @param {string} [opts.roomId]
 * @param {string} [opts.sessionToken]
 * @param {(url: string, opts: object) => any} [opts.socketFactory] - defaults to
 *        the CDN-pinned socket.io-client ESM `io` export
 */
export function createGameSocket({
  url = defaultUrl(),
  roomId = null,
  sessionToken = null,
  socketFactory = null,
  inputHz = INPUT_HZ,
  visibility = typeof document !== "undefined" ? document : null,
  clock = nowMs,
} = {}) {
  const bus = createEmitter();
  let socket = null;
  let factory = socketFactory;
  let subscribed = false;
  let connected = false;
  let inputSeq = 0;
  let passSeq = 0;
  let lastInput = { moveX: 0, moveZ: 0, sprint: false };
  let inputTimer = null;
  let lastPassAt = -Infinity;
  let pendingPass = null; // never replayed across reconnects
  let lastMatchId = null;
  let wantReady = null; // last readiness intent; re-sent after reconnect
  let connecting = null;

  /** Lazy import — the game keeps playing locally if the CDN import fails. */
  async function resolveFactory() {
    if (factory) return factory;
    if (!connecting) {
      connecting = (async () => {
        let mod;
        try {
          mod = await import("socket.io-client"); // index.html import map (pinned)
        } catch {
          mod = await import(/* @vite-ignore */ SOCKET_IO_URL); // fallback: same pinned URL
        }
        factory = mod.io ?? mod.default ?? mod.connect;
        return factory;
      })().catch((err) => {
        connecting = null;
        throw new Error(`socket.io-client failed to load: ${err?.message ?? err}`);
      });
    }
    return connecting;
  }

  const listeners = [];
  function listen(event, fn) {
    socket.on(event, fn);
    listeners.push([event, fn]);
  }

  function attach(sock) {
    socket = sock;
    listen("connect", () => {
      connected = true;
      // Subscribe FIRST: the server rejects ready/input from an unsubscribed
      // socket, and emits on one socket are delivered in order.
      if (subscribed) doSubscribe();
      if (lastMatchId) requestSnapshotNow(lastMatchId);
      if (wantReady != null) socket.emit("room:set_ready", { ready: wantReady });
      bus.emitLocal("connected", { id: socket.id });
    });
    listen("disconnect", (reason) => {
      connected = false;
      pendingPass = null;
      bus.emitLocal("disconnected", { reason });
    });
    listen("connect_error", (err) => {
      connected = false;
      bus.emitLocal("connect_error", { message: err?.message ?? String(err) });
    });
    listen("room:state", (s) => bus.emitLocal("room:state", s));
    listen("room:countdown", (c) => bus.emitLocal("room:countdown", c));
    listen("match:started", (m) => {
      if (m?.matchId) lastMatchId = m.matchId;
      bus.emitLocal("match:started", m);
    });
    listen("match:snapshot", (s) => {
      if (s?.matchId) lastMatchId = s.matchId;
      bus.emitLocal("match:snapshot", s);
    });
    listen("bomb:pass_accepted", (p) => {
      pendingPass = null;
      bus.emitLocal("bomb:pass_accepted", p);
    });
    listen("match:event", (e) => bus.emitLocal("match:event", e));
    listen("match:finished", (f) => bus.emitLocal("match:finished", f));
    // Settlement progress. Emitted after match:finished for funded rooms only:
    //   { state: 'SETTLING' }
    //   { state: 'CONFIRMED', txHash, payoutTxHash?, payoutState?, reason? }
    //   { state: 'FAILED', reason }
    // The client renders exactly this; it never infers PAID from a game result.
    listen("chain:status", (s) => bus.emitLocal("chain:status", s));
    listen("game:error", (e) => {
      const code = e?.code ?? "UNKNOWN";
      if (code === "PASS_COOLDOWN" || code === "PASS_LOCKBACK" || code === "NO_PASS_TARGET" || code === "NOT_BOMB_HOLDER") {
        pendingPass = null; // pass was decided; do not retry it
      }
      bus.emitLocal("game:error", e);
    });
  }

  function doSubscribe() {
    if (!socket || !roomId || !sessionToken) return false;
    socket.emit("room:subscribe", { roomId, sessionToken });
    return true;
  }

  /** Ask the server for a fresh snapshot (rate-limited server-side to 2/500ms). */
  function requestSnapshotNow(matchId = lastMatchId) {
    if (!matchId || !socket || !connected || !subscribed) return false;
    lastMatchId = matchId;
    socket.emit("match:request_snapshot", { matchId });
    return true;
  }

  function startInputLoop() {
    if (inputTimer != null) return;
    const every = Math.max(1, Math.round(1000 / inputHz));
    inputTimer = setInterval(() => {
      if (!connected || !subscribed) return;
      if (typeof visibility !== "undefined" && visibility && visibility.hidden) return;
      socket.emit("player:input", {
        sequence: ++inputSeq,
        moveX: clampAxis(lastInput.moveX),
        moveZ: clampAxis(lastInput.moveZ),
        sprint: !!lastInput.sprint,
      });
    }, every);
  }
  function stopInputLoop() {
    if (inputTimer != null) { clearInterval(inputTimer); inputTimer = null; }
  }

  const api = {
    on: bus.on.bind(bus),
    once: bus.once.bind(bus),
    off: bus.off.bind(bus),

    connect() {
      if (socket) return api;
      const finish = (f) => {
        if (socket) return api;
        attach(f(url, {
          auth: { eventVersion: PROTOCOL_VERSION },
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          autoConnect: true,
        }));
        startInputLoop();
      };
      if (factory) finish(factory);
      else resolveFactory().then(finish).catch((err) => bus.emitLocal("connect_error", { message: err.message }));
      return api;
    },

    /** Send room:subscribe now (or on next connect if offline). */
    subscribe(nextRoomId = roomId, nextToken = sessionToken) {
      if (nextRoomId) roomId = nextRoomId;
      if (nextToken) sessionToken = nextToken;
      subscribed = true;
      if (connected) doSubscribe();
      return api;
    },

    setReady(ready) {
      wantReady = !!ready;
      if (socket && connected && subscribed) socket.emit("room:set_ready", { ready: wantReady });
      return api;
    },

    /**
     * Latest-value input. Only the local player's own movement is sent; the
     * server integrates positions. Stored and transmitted at inputHz (≤30/s).
     */
    setInput({ moveX = 0, moveZ = 0, sprint = false } = {}) {
      lastInput = { moveX: clampAxis(moveX), moveZ: clampAxis(moveZ), sprint: !!sprint };
      return api;
    },

    /**
     * Edge-triggered pass intent (no target — server picks nearest eligible).
     * At most one pending intent; never replayed after reconnect.
     */
    pass() {
      const t = clock();
      if (pendingPass != null && t - pendingPass.at < 300) return false;
      if (t - lastPassAt < 350) return false; // local guard under server's 700 ms
      if (!socket || !connected || !subscribed) return false;
      lastPassAt = t;
      pendingPass = { at: t };
      socket.emit("bomb:pass_intent", { sequence: ++passSeq });
      return true;
    },

    requestSnapshot(matchId = lastMatchId) {
      return requestSnapshotNow(matchId);
    },

    get matchId() { return lastMatchId; },
    get isConnected() { return connected; },
    get isSubscribed() { return subscribed; },
    get hasPendingPass() { return pendingPass != null; },
    get raw() { return socket; },

    disconnect() {
      stopInputLoop();
      if (socket) {
        for (const [event, fn] of listeners) socket.off(event, fn);
        listeners.length = 0;
        socket.disconnect();
        socket = null;
      }
      connected = false;
      subscribed = false;
      bus.removeAll();
    },
  };
  return api;
}

function clampAxis(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

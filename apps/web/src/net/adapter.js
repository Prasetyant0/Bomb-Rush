// net/adapter.js — translates the server's participantId-based MatchSnapshot
// into the seat-indexed shape apps/web/src/game/engine.js renders.
//
// TRUTH RULE: every gameplay value in a view comes from the last server
// snapshot or is a pure function of server-provided fields (bomb deadline,
// livingCount). Nothing here decides winners, holders, stamina or positions.
// Interpolation only ever blends between two snapshots the server sent, with
// the blend factor clamped to [0,1] — so it can never overshoot or extrapolate.
//
// Server snapshot shape (apps/server/src/game/domain.ts matchSnapshot):
//   { matchId, tick, serverTimeMs, players:[{ participantId, kind, position:{x,y,z},
//     velocity:{x,z}, facingYaw, alive, stamina, isSprinting, disconnected }],
//     bombHolderId, bombExpiresAtMs, livingCount, status }
//
// Engine expects (apps/web/src/game/sim.js):
//   room.players[seat] = { seat, name, pos:{x,z}, stamina, alive, isSprinting,
//     moving, face }, room.holderSeat, room.bombTimer, room.round, room.over.

export const MAX_SEATS = 4;
export const SNAPSHOT_INTERP_HZ = 15; // render samples per snapshot window
export const INTERP_DELAY_MS = 1000 / SNAPSHOT_INTERP_HZ; // ~66.7 ms (one snapshot behind)

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Linear blend, clamped — the only interpolation primitive used here. */
export function lerp(a, b, t) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isFinite(b) ? b : a || 0;
  return a + (b - a) * clamp01(t);
}

/**
 * Deterministic participantId → seat mapping.
 * Seat 0 is ALWAYS the local participant (engine.js hard-codes players[0] as
 * "you"). Remaining seats follow server snapshot order (join order), which is
 * stable for the duration of a LIVE match.
 * Unknown/absent ids are simply not seated (seatOf returns -1).
 */
export function mapSeats(participantIds, localParticipantId = null, maxSeats = MAX_SEATS) {
  const order = [];
  if (localParticipantId && participantIds.includes(localParticipantId)) order.push(localParticipantId);
  for (const id of participantIds) {
    if (id === localParticipantId || order.includes(id)) continue;
    if (order.length >= maxSeats) break;
    order.push(id);
  }
  // local seat must be 0 even if the local id is missing from this snapshot
  const seatById = new Map();
  order.forEach((id, seat) => seatById.set(id, seat));
  return { order: order.slice(0, maxSeats), seatById };
}

function nextId() {
  return typeof Date !== "undefined" ? Date.now() : 0;
}

function validSnapshot(snap) {
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.players)) return false;
  // A LIVE server snapshot always carries at least one identified player; a
  // payload without any is malformed and must never become render state.
  return snap.players.some((p) => p && typeof p.participantId === "string");
}

/**
 * Create an adapter for one networked match.
 *
 * @param {object} opts
 * @param {string|null} opts.localParticipantId - server participant id of this client
 * @param {Record<string,string>} [opts.names] - optional display names by participantId
 * @param {number} [opts.maxSeats]
 * @param {number} [opts.interpDelayMs] - render delay, defaults to 1/15 s
 */
export function createAdapter({
  localParticipantId = null,
  names = {},
  maxSeats = MAX_SEATS,
  interpDelayMs = INTERP_DELAY_MS,
} = {}) {
  let seatOrder = [];
  let seatById = new Map();
  let curr = null; // { snap, receivedAtMs, tick, serverTimeMs, players: Map(id -> player) }
  let prev = null;
  let lastTick = -Infinity;
  let lastPass = null;
  let localSeat = -1;

  function build(snap, receivedAtMs) {
    const ids = snap.players.map((p) => p && p.participantId).filter((id) => typeof id === "string");
    const mapping = mapSeats(ids, localParticipantId, maxSeats);
    const byId = new Map();
    for (const p of snap.players) {
      if (p && typeof p.participantId === "string" && mapping.seatById.has(p.participantId)) {
        byId.set(p.participantId, p);
      }
    }
    return {
      snap,
      receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : nextId(),
      tick: Number.isFinite(snap.tick) ? snap.tick : null,
      serverTimeMs: Number.isFinite(snap.serverTimeMs) ? snap.serverTimeMs : null,
      order: mapping.order,
      seatById: mapping.seatById,
      byId,
    };
  }

  /** Feed one server snapshot. Older ticks are ignored (never rewind truth). */
  function applySnapshot(snap, { receivedAtMs = nextId() } = {}) {
    if (!validSnapshot(snap)) return false;
    if (Number.isFinite(snap.tick) && snap.tick < lastTick) return false; // stale/out of order
    if (Number.isFinite(snap.tick)) lastTick = snap.tick;

    const next = build(snap, receivedAtMs);
    // Roster/seat assignment changed → do not interpolate between two different
    // people; snap to the new truth this frame.
    const sameRoster =
      next.order.length === seatOrder.length && next.order.every((id, i) => id === seatOrder[i]);
    prev = sameRoster ? curr : null;
    curr = next;
    seatOrder = next.order;
    seatById = next.seatById;
    localSeat = localParticipantId ? (seatById.get(localParticipantId) ?? -1) : -1;
    return true;
  }

  function seatOf(participantId) {
    return seatById.get(participantId) ?? -1;
  }

  function idAt(seat) {
    return seatOrder[seat] ?? null;
  }

  function nameOf(participantId) {
    if (!participantId) return "—";
    if (names[participantId]) return names[participantId];
    const seat = seatOf(participantId);
    if (seat === 0 && localParticipantId === participantId) return names.local || "YOU";
    return seat >= 0 ? `P${seat + 1}` : "—";
  }

  /** Register a display name learned from the lobby (never a gameplay field). */
  function setName(participantId, name) {
    if (typeof participantId !== "string" || typeof name !== "string" || !name) return;
    names[participantId] = name;
  }

  /** Server-acknowledged pass — informational only; holder truth is snapshot. */
  function applyPassAccepted(payload) {
    if (!payload || typeof payload.fromId !== "string" || typeof payload.toId !== "string") return null;
    const fromSeat = seatOf(payload.fromId);
    const toSeat = seatOf(payload.toId);
    if (fromSeat < 0 || toSeat < 0) return null; // unknown participant: ignore, never crash
    lastPass = { fromSeat, toSeat, at: nextId() };
    return lastPass;
  }

  function applyRoomState(state) {
    // Room roster is only used for lobby UI; LIVE truth stays in snapshots.
    return state && Array.isArray(state.participants) ? state : null;
  }

  /**
   * Seat-indexed render view at wall-clock nowMs (Date.now()).
   * Positions blend prev→curr over the measured snapshot interval with a
   * one-snapshot render delay; alpha is clamped so values stay inside the two
   * server samples (no overshoot, monotonic when the server moves monotonically).
   */
  function view(nowMs = nextId()) {
    if (!curr) return null;
    const snap = curr.snap;
    const interval = prev
      ? Math.max(1, curr.receivedAtMs - prev.receivedAtMs)
      : Math.max(1, 1000 / SNAPSHOT_INTERP_HZ);
    // Render slightly behind the newest snapshot for a full interpolation window.
    const alpha = prev ? clamp01((nowMs - curr.receivedAtMs + interpDelayMs) / interval) : 1;

    // Estimate the server clock from the newest snapshot (clock offset only;
    // this does not invent game state).
    const serverNowMs =
      curr.serverTimeMs != null ? curr.serverTimeMs + (nowMs - curr.receivedAtMs) : null;
    const remainingMs =
      snap.bombExpiresAtMs != null && serverNowMs != null
        ? Math.max(0, snap.bombExpiresAtMs - serverNowMs)
        : snap.bombExpiresAtMs != null
          ? Math.max(0, snap.bombExpiresAtMs - (curr.serverTimeMs ?? 0))
          : 0;

    const players = new Array(curr.order.length).fill(null);
    for (let seat = 0; seat < curr.order.length; seat++) {
      const id = curr.order[seat];
      const p = curr.byId.get(id);
      if (!p) continue;
      const before = prev ? prev.byId.get(id) : null;
      const x0 = before && before.position ? before.position.x : p.position.x;
      const z0 = before && before.position ? before.position.z : p.position.z;
      players[seat] = {
        seat,
        participantId: id,
        name: nameOf(id),
        pos: {
          x: lerp(x0, p.position.x, alpha),
          z: lerp(z0, p.position.z, alpha),
        },
        // Snapshotted fields — copied verbatim, never interpolated/invented.
        stamina: p.stamina,
        alive: !!p.alive,
        isSprinting: !!p.isSprinting,
        disconnected: !!p.disconnected,
        facingYaw: p.facingYaw,
        kind: p.kind,
      };
    }

    const livingCount = Number.isFinite(snap.livingCount)
      ? snap.livingCount
      : players.filter((p) => p && p.alive).length;
    const rosterSize = Math.max(1, curr.order.length);
    return {
      matchId: snap.matchId,
      tick: snap.tick,
      serverTimeMs: snap.serverTimeMs,
      status: snap.status,
      players,
      seatCount: curr.order.length,
      localSeat,
      holderSeat: seatOf(snap.bombHolderId),
      holderId: snap.bombHolderId ?? null,
      livingCount,
      // Round number derived from server livingCount (server has no round field).
      round: Math.max(1, rosterSize - livingCount + 1),
      // Remaining seconds derived from the server-owned deadline.
      bombTimer: remainingMs / 1000,
      pass: lastPass,
    };
  }

  return {
    applySnapshot,
    applyRoomState,
    applyPassAccepted,
    view,
    seatOf,
    idAt,
    nameOf,
    setName,
    get localSeat() { return localSeat; },
    get seatCount() { return seatOrder.length; },
    get hasSnapshot() { return !!curr; },
    get lastSnapshot() { return curr ? curr.snap : null; },
  };
}

// ---------------------------------------------------------------------------
// Engine render bridge (browser only).
// engine.js owns its own room and a local 20 Hz sim loop. In networked mode we
// let that loop keep running (it drives animations, HUD and camera) but make
// its writes harmless: every player pos is replaced with a guarded vector that
// ignores local-sim mutation. Snapshot-derived values are then written each
// frame. Local prediction is intentionally NOT applied — server truth is drawn
// directly, so every snapshot is also the snap-back.
// ---------------------------------------------------------------------------

/** A sim-mutable vector whose x/z can only be changed by the bridge. */
function guardedPos() {
  let x = 0, z = 0, writable = false;
  const self = {
    get x() { return x; },
    set x(v) { if (writable) x = v; },
    get z() { return z; },
    set z(v) { if (writable) z = v; },
    set(nx, nz) { if (writable) { x = nx; z = nz; } return self; },
    copy(v) { if (writable) { x = v.x; z = v.z; } return self; },
    add(v) { if (writable) { x += v.x; z += v.z; } return self; },
    sub(v) {
      const dx = x - v.x, dz = z - v.z;
      return { x: dx, z: dz, len: () => Math.hypot(dx, dz) };
    },
    mul(s) { if (writable) { x *= s; z *= s; } return self; },
    len() { return Math.hypot(x, z); },
    norm() { const l = self.len(); return l > 1 ? self.mul(1 / l) : self; },
    clone() {
      const dx = x, dz = z;
      return {
        x: dx, z: dz,
        mul(s) { return { x: dx * s, z: dz * s }; },
      };
    },
  };
  return {
    pos: self,
    set(nx, nz) {
      writable = true;
      try { x = Number.isFinite(nx) ? nx : 0; z = Number.isFinite(nz) ? nz : 0; } finally { writable = false; }
    },
  };
}

/**
 * Bind an adapter view onto a bootMatch() API. Returns { detach }.
 * @param {object} opts
 * @param {object} opts.api - value returned by engine bootMatch(host)
 * @param {ReturnType<createAdapter>} opts.adapter
 * @param {(msg: string) => void} [opts.onError]
 */
export function bindEngineRoom({ api, adapter, now = () => Date.now(), schedule = null, onLocalInput = null } = {}) {
  if (!api || !adapter) return { detach() {} };
  const room = api.room;
  if (!room || !Array.isArray(room.players)) return { detach() {} };

  // Server-owned scalars become read-only to the local sim loop: a write from
  // sim.step()/startRound() is ignored; the pump is the only writer.
  function guard(key, initial) {
    let value = initial;
    let privileged = false;
    Object.defineProperty(room, key, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v) => { if (privileged) value = v; },
    });
    return (v) => { privileged = true; try { value = v; } finally { privileged = false; } };
  }
  const setBombTimer = guard("bombTimer", room.bombTimer);
  const setOver = guard("over", false);
  const setWinnerSeat = guard("winnerSeat", null);
  const setRound = guard("round", room.round);
  const setHolderSeat = guard("holderSeat", room.holderSeat);

  function guardPlayer(p, key, initial) {
    let value = initial;
    let privileged = false;
    Object.defineProperty(p, key, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v) => { if (privileged) value = v; },
    });
    return (v) => { privileged = true; try { value = v; } finally { privileged = false; } };
  }
  const playerSetters = room.players.map((p) => ({
    stamina: guardPlayer(p, "stamina", p.stamina),
    isSprinting: guardPlayer(p, "isSprinting", p.isSprinting),
    alive: guardPlayer(p, "alive", p.alive),
    // Local sim pass() checks `clock - lastPassAt < cooldown`; pinning this to
    // Infinity makes every local pass attempt a no-op. Real passes go out as
    // socket bomb:pass_intent and the server decides.
    lastPassAt: guardPlayer(p, "lastPassAt", Infinity),
  }));
  // Local feed is cosmetic; server events are surfaced by app.js instead.
  Object.defineProperty(room, "feed", {
    configurable: true,
    enumerable: true,
    value: { push() {}, slice: () => [], length: 0 },
  });

  const guarded = room.players.map((p) => {
    const g = guardedPos();
    g.set(p.pos?.x ?? 0, p.pos?.z ?? 0);
    p.pos = g.pos;
    p.moving = false;
    return g;
  });
  const lastPos = room.players.map(() => null);
  const raf = schedule || (typeof requestAnimationFrame === "function" ? requestAnimationFrame : null);
  let alive = true;
  let frame = null;

  function pump() {
    if (!alive) return;
    const v = adapter.view(now());
    if (v) {
      for (let seat = 0; seat < room.players.length; seat++) {
        const p = room.players[seat];
        const s = v.players[seat];
        if (!p) continue;
        if (!s) { playerSetters[seat].alive(false); p.moving = false; continue; } // seat empty on server
        if (guarded[seat]) guarded[seat].set(s.pos.x, s.pos.z);
        p.name = s.name;
        playerSetters[seat].stamina(s.stamina);
        playerSetters[seat].isSprinting(s.isSprinting);
        playerSetters[seat].alive(s.alive);
        p.seat = seat;
        // "moving" is a render-only flag derived from server position deltas.
        const last = lastPos[seat];
        p.moving = !!last && Math.hypot(s.pos.x - last.x, s.pos.z - last.z) > 1e-4;
        lastPos[seat] = { x: s.pos.x, z: s.pos.z };
        // Cosmetic face cues derived from server-owned fields (no game state).
        p.face = s.alive ? (v.holderSeat === seat && v.bombTimer <= 3 ? "panic" : "playing") : "dizzy";
        if (seat === v.localSeat) {
          // Raw local intent is forwarded, never integrated locally. p.move is
          // left untouched for this seat so the engine's key→move write stays
          // readable here (it also drives only cosmetic rotation).
          if (onLocalInput) onLocalInput({ moveX: p.move?.x ?? 0, moveZ: p.move?.z ?? 0, sprint: !!p.wantsSprint });
        } else if (Number.isFinite(s.facingYaw) && p.move && typeof p.move.set === "function") {
          // Remote seats rotate from the server's facingYaw (cosmetic only).
          p.move.set(Math.sin(s.facingYaw), Math.cos(s.facingYaw));
        }
      }
      setHolderSeat(v.holderSeat);
      // True remaining time for the HUD. Every state a local explosion could
      // write (alive, holderSeat, bombTimer, over, winnerSeat) is guard-pinned
      // above, so even if the local loop's timer read hits zero its verdict is
      // inert — elimination still arrives only via the next server snapshot.
      setBombTimer(Math.max(0, v.bombTimer));
      setRound(v.round);
      setOver(false);
      setWinnerSeat(null);
    }
    frame = raf ? raf(pump) : setTimeout(pump, 1000 / 60);
  }
  pump();

  return {
    detach() {
      alive = false;
      if (frame != null) {
        if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
        else clearTimeout(frame);
      }
    },
  };
}

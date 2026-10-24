// BOMB RUSH sim — authoritative gameplay engine (docs/spec/GAMEPLAY_CONTROLS.md).
// Framework-free, zero three.js: runs unchanged in Node for the QA vectors (GS-01..07)
// in sim.test.js, and is the exact module a 20 Hz server would import (SYS.md §5).
// The client predicts locally with step() and corrects against server snapshots later.
// Clock contract (SYS.md monotonic): NEVER integrate from packet/frame counts. step()
// takes dt clamped to MAX_DT so a stalled loop produces a small jump, not teleport.

export const ARENA_RADIUS = 10; // matches ArenaScene.js
export const WALK_SPEED = 4.5; // units/s
export const SPRINT_SPEED = 7.0; // units/s
export const STAMINA_MAX = 5.0; // bars
export const SPRINT_DRAIN = 1.0; // bars/s
export const REGEN_RATE = 1.0; // bars/s
export const REGEN_DELAY = 1.5; // s after last active sprint frame
export const SPRINT_REENABLE = 0.5; // bars — forced-walk floor (GC §4)
export const BOMB_TIMER = 10.0; // s per explosion; transfer never resets it (GC §1.3)
export const PASS_RANGE = 1.8; // units — nearest eligible target only (GC §5)
export const PASS_COOLDOWN = 0.7; // s since passser's last successful pass
export const LOCKBACK = 1.0; // s the former holder is blocked as target (GC §5)
export const SEATS = 4;
export const MAX_DT = 0.1; // per-tick clamp (SYS.md)
export const PLAYER_RADIUS = 0.55; // soft-separation half distance

export class V {
  constructor(x = 0, z = 0) { this.x = x; this.z = z; }
  set(x, z) { this.x = x; this.z = z; return this; }
  copy(v) { this.x = v.x; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.z += v.z; return this; }
  sub(v) { return new V(this.x - v.x, this.z - v.z); }
  mul(s) { this.x *= s; this.z *= s; return this; }
  len() { return Math.hypot(this.x, this.z); }
  norm() { const l = this.len(); return l > 1 ? this.mul(1 / l) : this; }
  clone() { return new V(this.x, this.z); }
}

// keep inside the octagonal arena (used by both movement and separation push).
// Margin 1.0 = visual rim (torus at r=10, tube 0.35) + full avatar half-width,
// so the whole mesh stays off the barrier — not just the center point.
export function clampArena(pos) {
  const len = pos.len();
  const max = ARENA_RADIUS - 1.0;
  if (len > max) pos.mul(max / len);
}

export function makeRoom(code = "ROOM") {
  return { code, round: 0, players: [], holderSeat: -1, bombTimer: 0, clock: 0,
    over: false, winnerSeat: null, feed: [] };
}

export function addPlayer(room, name = `P${room.players.length + 1}`) {
  if (room.players.length >= SEATS) return null;
  const p = {
    seat: room.players.length, name,
    pos: new V(), move: new V(), wantsSprint: false,
    stamina: STAMINA_MAX, isSprinting: false, moving: false,
    alive: true, lastPassAt: -Infinity, lastHeldAt: -Infinity,
    face: "idle", elimAt: null,
  };
  room.players.push(p);
  return p;
}

function log(room, msg) {
  room.feed.push({ at: +room.clock.toFixed(1), msg });
  if (room.feed.length > 30) room.feed.shift();
}

// spawn equidistant, pick seeded holder, reset per-round state (GC §1.2)
export function startRound(room, seed = Math.random()) {
  const n = room.players.length;
  if (n < 3) return false;
  room.round++;
  const base = seed * Math.PI * 2;
  room.players.forEach((p, i) => {
    const ang = base + (i / n) * Math.PI * 2;
    p.pos.set(Math.cos(ang) * 6, Math.sin(ang) * 6);
    p.move.set(0, 0);
    p.stamina = STAMINA_MAX;
    p.isSprinting = p.wantsSprint = p.moving = false;
    p.alive = true;
    p.lastPassAt = p.lastHeldAt = -Infinity;
    p.face = "idle";
    p.lastSprintEndedAt = -Infinity;
  });
  room.holderSeat = room.players[Math.floor(seed * n * 1000) % n].seat;
  // the initial holder is "former holder" for its own lockback once it passes
  room.players.forEach((p) => (p.lastHeldAt = -Infinity));
  room.players[room.holderSeat].lastHeldAt = 0;
  room.bombTimer = BOMB_TIMER;
  room.clock = 0;
  room.over = false;
  room.winnerSeat = null;
  room.feed.length = 0;
  log(room, `${room.players[room.holderSeat].name} has the bomb`);
  return true;
}

const nameOf = (room, seat) => room.players.find((p) => p.seat === seat)?.name ?? "?";

// per-tick input intent: world-space move vector + sprint request (GC §2)
export function input(p, mx, mz, sprint) {
  p.move.set(mx, mz).norm(); // GS-04: server clamps magnitude to 1 — no diagonal boost
  p.wantsSprint = !!sprint;
}

// ---------------------------------------------------------------
// advance the room by dt seconds of authoritative time
// ---------------------------------------------------------------
export function step(room, dt = 1 / 20) {
  if (room.over) return;
  dt = Math.min(dt, MAX_DT);
  const live = room.players.filter((p) => p.alive);

  // 1. movement + stamina from elapsed server time (GS-10: not packet counted)
  for (const p of live) {
    const moving = p.move.len() > 0.01;
    p.moving = moving;

    // actual sprint = requested ∧ moving ∧ fueled. Anti-flicker hysteresis (GC §4):
    // once the 0.5-bar floor has locked sprint out, only refilling to ≥0.5 unlocks it —
    // p.reenabled tracks that latch so draining 0.49→0.01 doesn't flicker sprint on/off.
    let actually = p.wantsSprint && moving && p.stamina > 0;
    if (actually && !p.reenabled) actually = p.stamina >= SPRINT_REENABLE;
    if (p.stamina >= SPRINT_REENABLE || actually) p.reenabled = true;
    else p.reenabled = false;

    if (actually) {
      p.stamina -= SPRINT_DRAIN * dt;
      if (p.stamina < 1e-9) p.stamina = 0; // snap: no 1e-14 slivers — GC §4 "at zero" is exact
      p.lastSprintEndedAt = room.clock + dt; // recovery counts from the last burn frame
    }
    // the tick that burns stamina down TO zero already reads as forced-walk
    // (GC §4 "at zero: forced walk") — this frame's speed was still sprint's
    p.isSprinting = actually && p.stamina > 0;

    // regen only when not sprinting and past the 1.5 s recovery delay (GS-02/03)
    // (epsilon: accumulated 1/60 steps miss the exact threshold by float drift)
    if (!actually && room.clock - p.lastSprintEndedAt >= REGEN_DELAY - 1e-9) {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + REGEN_RATE * dt);
    }

    if (moving) {
      p.pos.add(p.move.clone().mul((actually ? SPRINT_SPEED : WALK_SPEED) * dt));
    }
    clampArena(p.pos);
  }

  // 2. soft player separation — ONLY nudges a player who is standing still.
  // A moving player is never displaced by contact: being shoved while walking
  // reads as "WASD random" to the user (the walked-out-of-line complaint).
  // The contact still blocks the pusher (clamped in movement next tick).
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const len = Math.hypot(dx, dz);
      if (len < PLAYER_RADIUS * 2 && len > 1e-4) {
        const push = (PLAYER_RADIUS * 2 - len) / 2;
        const nx = dx / len, nz = dz / len;
        // each side moves only if it is the stationary one —
        // both stationary: symmetric half-push; one moving: only that one yields
        if (!a.moving && !b.moving) {
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        } else if (!a.moving) {
          a.pos.x -= nx * push * 2; a.pos.z -= nz * push * 2;
        } else if (!b.moving) {
          b.pos.x += nx * push * 2; b.pos.z += nz * push * 2;
        }
        clampArena(a.pos); clampArena(b.pos);
      }
    }
  }

  room.clock += dt;

  // 3. bomb countdown on server clock (never on client) (GC §1.3)
  room.bombTimer = Math.max(0, room.bombTimer - dt);
  const holder = room.players[room.holderSeat];
  if (holder?.alive) {
    holder.face = room.bombTimer <= 3 ? "panic" : "playing";
    if (room.bombTimer <= 3 && !holder.warned) {
      holder.warned = true; log(room, `${holder.name} panics — 3s!`);
    }
  }

  // 4. explosion eliminates the current holder (GC §1.4)
  if (room.bombTimer <= 0) {
    if (holder?.alive) {
      holder.alive = false;
      holder.elimAt = room.clock;
      holder.face = "dizzy";
      log(room, `💥 ${holder.name} eliminated`);
    }
    const survivors = room.players.filter((p) => p.alive);
    if (survivors.length <= 1) {
      room.over = true;
      room.winnerSeat = survivors[0]?.seat ?? null;
      if (survivors[0]) log(room, `🏆 ${survivors[0].name} wins (${survivors.length} alive)`);
      return;
    }
    room.holderSeat = survivors[0].seat;
    room.bombTimer = BOMB_TIMER;
    for (const p of room.players) p.warned = false;
    log(room, `💣 ${nameOf(room, room.holderSeat)} is it`);
  }
}

// pass attempt: intent carries NO target — server picks nearest eligible (GC §5)
export function pass(room, seat) {
  if (room.over) return { ok: false, err: "over" };
  const from = room.players[seat];
  if (seat !== room.holderSeat || !from?.alive) return { ok: false, err: "not-holder" };
  if (room.clock - from.lastPassAt < PASS_COOLDOWN) return { ok: false, err: "cooldown" };

  // eligible: alive, in range, not the last holder inside the lockback window
  const eligible = room.players.filter(
    (p) => p.alive && p.seat !== seat &&
      p.pos.sub(from.pos).len() <= PASS_RANGE &&
      room.clock - p.lastHeldAt >= LOCKBACK,
  );
  if (!eligible.length) return { ok: false, err: "no-target" }; // GS-05/GS-06

  eligible.sort((a, b) => a.pos.sub(from.pos).len() - b.pos.sub(from.pos).len() || a.seat - b.seat);
  const to = eligible[0];

  from.lastPassAt = room.clock;
  // lockback anchor = the passer (GC §5: former holder can't be a TARGET for 1 s)
  from.lastHeldAt = room.clock;
  room.holderSeat = to.seat;
  // bombTimer deliberately NOT reset (GC §1.3)
  from.face = "happy"; to.face = "panic"; to.warned = false;
  log(room, `🤲 ${from.name} → ${to.name} @ ${room.bombTimer.toFixed(1)}s`);
  return { ok: true, to: to.seat };
}

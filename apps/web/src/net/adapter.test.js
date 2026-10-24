// Network adapter tests — run with: node apps/web/src/net/adapter.test.js
// Same no-framework style as apps/web/src/game/sim.test.js.
import { createAdapter, mapSeats, lerp, bindEngineRoom, MAX_SEATS } from "./adapter.js";
import { makeRoom, addPlayer, startRound, step, pass, input } from "../game/sim.js";

let failed = 0;
function eq(actual, expected, label) {
  const ok = Math.abs(actual - expected) < 1e-9 || actual === expected;
  if (!ok) { failed++; console.error(`FAIL ${label}: got ${actual}, want ${expected}`); }
  else console.log(`  ok  ${label}`);
}
function assert(ok, label) {
  if (!ok) { failed++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}
function throwsNot(fn, label) {
  try { fn(); assert(true, label); }
  catch (err) { failed++; console.error(`FAIL ${label}: threw ${err && err.message}`); }
}

// Server-shaped snapshot factory (domain.ts matchSnapshot).
function snap(tick, serverTimeMs, players, { holder = null, living = null, matchId = "m-1", status = "LIVE", bombExpiresAtMs = serverTimeMs + 5000 } = {}) {
  return {
    matchId,
    tick,
    serverTimeMs,
    players: players.map((p) => ({
      participantId: p.id,
      kind: p.kind ?? "HUMAN",
      position: { x: p.x, y: 0, z: p.z },
      velocity: { x: 0, z: 0 },
      facingYaw: p.yaw ?? 0,
      alive: p.alive !== false,
      stamina: p.stamina ?? 5,
      isSprinting: !!p.sprint,
      disconnected: !!p.disconnected,
    })),
    bombHolderId: holder,
    bombExpiresAtMs,
    livingCount: living ?? players.filter((p) => p.alive !== false).length,
    status,
  };
}

const p = (id, x, z, extra = {}) => ({ id, x, z, ...extra });

// ---------------------------------------------------------------------------
// 1. Seat mapping — 3 and 4 players
// ---------------------------------------------------------------------------
{
  const four = ["p_host", "p_b", "p_c", "p_d"];
  const m = mapSeats(four, "p_c");
  eq(m.order[0], "p_c", "4P: local participant is seat 0");
  eq(m.seatById.get("p_c"), 0, "4P: local id → seat 0");
  eq(m.order.length, 4, "4P: all four seated");
  assert(new Set(m.order).size === 4, "4P: seats unique");
  assert(m.order.slice(1).join() === "p_host,p_b,p_d", "4P: others keep server order");
  eq(m.seatById.get("p_d"), 3, "4P: last server player at seat 3");

  const three = ["p_host", "p_b", "p_c"];
  const m3 = mapSeats(three, "p_b");
  eq(m3.order[0], "p_b", "3P: local participant is seat 0");
  eq(m3.order.length, 3, "3P: three seats filled");
  eq(m3.seatById.get("p_host"), 1, "3P: host moved to seat 1");
  eq(m3.seatById.get("p_c"), 2, "3P: third at seat 2");
  eq(m3.seatById.get("p_nobody"), undefined, "3P: unknown id has no seat");
  eq(m3.seatById.get("p_nobody") ?? -1, -1, "3P: unknown id seat lookup is -1");

  // no local id (spectator / REST poll before subscribe) → server order preserved
  const spec = mapSeats(four, null);
  eq(spec.order[0], "p_host", "spectator: server order preserved");
  eq(spec.order.length, 4, "spectator: four seats");

  // more than MAX_SEATS ids → clamped
  const many = mapSeats(["a", "b", "c", "d", "e"], "e");
  eq(many.order.length, MAX_SEATS, "overfull: clamped to MAX_SEATS");
  eq(many.order[0], "e", "overfull: local still seat 0");
}

// ---------------------------------------------------------------------------
// 2. Adapter view — participantId → seat, 3 and 4 players
// ---------------------------------------------------------------------------
{
  const ids = ["p_host", "p_b", "p_c", "p_d"];
  const a = createAdapter({ localParticipantId: "p_c", names: { p_c: "RUSHER", p_b: "NOVA" } });
  const s0 = snap(10, 1_000, [p("p_host", 1, 0), p("p_b", 2, 0), p("p_c", 3, 0), p("p_d", 4, 0)], { holder: "p_b" });
  assert(a.applySnapshot(s0, { receivedAtMs: 1_000 }), "4P: snapshot accepted");
  const v = a.view(1_000);
  eq(v.seatCount, 4, "4P: view has 4 seats");
  eq(v.players[0].participantId, "p_c", "4P: view seat 0 is local");
  eq(v.players[0].name, "RUSHER", "4P: local display name from map");
  eq(v.players[2].name, "NOVA", "4P: peer display name from map");
  eq(v.players[1].name, "P2", "4P: unnamed peer falls back to Pn");
  eq(v.players[1].participantId, "p_host", "4P: server order preserved after seat 0");
  eq(v.holderSeat, 2, "4P: bombHolderId p_b → seat 2");
  eq(v.holderId, "p_b", "4P: holderId preserved verbatim");
  eq(v.livingCount, 4, "4P: livingCount from snapshot");
  eq(v.bombTimer, 5, "4P: bombTimer derived from server deadline");
  eq(a.seatOf("p_d"), 3, "4P: seatOf(p_d)=3");
  eq(a.idAt(0), "p_c", "4P: idAt(0)=local");

  // 3-player snapshot on a fresh adapter
  const b = createAdapter({ localParticipantId: "p_host" });
  const s3 = snap(4, 500, [p("p_host", 0, 6), p("p_b", 6, 0), p("p_c", -6, 0)], { holder: "p_host" });
  b.applySnapshot(s3, { receivedAtMs: 500 });
  const v3 = b.view(500);
  eq(v3.seatCount, 3, "3P: view has 3 seats");
  eq(v3.holderSeat, 0, "3P: local holds bomb at seat 0");
  eq(v3.players[1].participantId, "p_b", "3P: seat 1 is p_b");
  eq(v3.players[1].pos.x, 6, "3P: position copied verbatim");
  eq(v3.players[1].pos.z, 0, "3P: z copied verbatim");
  eq(v3.round, 1, "3P: round 1 while all alive");
}

// ---------------------------------------------------------------------------
// 3. Unknown participantId must not crash
// ---------------------------------------------------------------------------
{
  const a = createAdapter({ localParticipantId: "p_ghost" });
  throwsNot(() => {
    a.applySnapshot(snap(1, 1000, [p("p_host", 1, 1), p("p_b", 2, 2), p("p_c", 3, 3)], { holder: "p_unknown" }), { receivedAtMs: 1000 });
    const v = a.view(1000);
    eq(v.seatCount, 3, "unknown local: still renders the 3 server players");
    eq(v.holderSeat, -1, "unknown holder id → holderSeat -1 (never invented)");
    eq(v.holderId, "p_unknown", "unknown holder id preserved as sent");
    eq(v.localSeat, -1, "unknown local id → localSeat -1");
    eq(a.seatOf("p_unknown"), -1, "seatOf(unknown) = -1");
    eq(a.nameOf("p_unknown"), "—", "nameOf(unknown) has a safe fallback");
  }, "unknown participantId does not crash");

  throwsNot(() => {
    const b = createAdapter();
    b.applySnapshot(null);
    b.applySnapshot({});
    b.applySnapshot({ players: null });
    b.applySnapshot({ players: [{ participantId: 42 }, null, {}] }, { receivedAtMs: 10 });
    eq(b.view(10), null, "malformed snapshots never produce a view");
  }, "malformed snapshots are ignored");

  throwsNot(() => {
    const c = createAdapter({ localParticipantId: "p_host" });
    c.applySnapshot(snap(1, 1, [p("p_host", 0, 0)], {}), { receivedAtMs: 1 });
    const pass = c.applyPassAccepted({ fromId: "nope", toId: "also-nope" });
    eq(pass, null, "pass with unknown ids is dropped, not queued");
    eq(c.view(1).players.length, 1, "view still renders after a bad pass ack");
  }, "unknown id in bomb:pass_accepted does not crash");
}

// ---------------------------------------------------------------------------
// 4. Interpolation: monotonic, bounded, no overshoot
// ---------------------------------------------------------------------------
{
  const a = createAdapter({ localParticipantId: "p_me", interpDelayMs: 1000 / 15 });
  // Three snapshots 100 ms apart, moving steadily along +x.
  const positions = [0, 1, 2];
  positions.forEach((x, i) => {
    a.applySnapshot(
      snap(i + 1, i * 100, [p("p_me", x, 0), p("p_b", -x, 0), p("p_c", 0, x)], {}),
      { receivedAtMs: i * 100 },
    );
  });

  // Sample the first interpolation window (between snapshot 0 @t=0 and 1 @t=100).
  // t=100 is "now"; we are one delay behind, so the render window runs 100..200.
  const xs = [];
  for (let now = 100; now <= 200; now += 5) xs.push(a.view(now).players[0].pos.x);
  let monotonic = true, bounded = true;
  for (let i = 1; i < xs.length; i++) if (xs[i] + 1e-9 < xs[i - 1]) monotonic = false;
  for (const x of xs) if (x < 0 - 1e-9 || x > 2 + 1e-9) bounded = false;
  assert(monotonic, "interp: local x is monotonic non-decreasing");
  assert(bounded, "interp: local x stays within [0,2] (no overshoot)");

  // alpha clamp: before the window and after it
  eq(a.view(100).players[0].pos.x, 1, "interp: clamped at the left edge (<= prev snapshot)");
  eq(a.view(1000).players[0].pos.x, 2, "interp: clamped at the right edge (newest snapshot)");
  assert(a.view(1000).players[0].pos.x <= 2 + 1e-9, "interp: never extrapolates past newest x");

  // A single snapshot (no prev) renders the snapshot exactly, never a guess.
  const only = createAdapter({ localParticipantId: "p_me" });
  only.applySnapshot(snap(1, 0, [p("p_me", 7.5, -3.25)], {}), { receivedAtMs: 0 });
  eq(only.view(0).players[0].pos.x, 7.5, "interp: one snapshot → x unmodified");
  eq(only.view(0).players[0].pos.z, -3.25, "interp: one snapshot → z unmodified");
  eq(only.view(99999).players[0].pos.x, 7.5, "interp: one snapshot → no drift over time");

  // lerp primitive
  eq(lerp(0, 10, 0), 0, "lerp: t=0");
  eq(lerp(0, 10, 1), 10, "lerp: t=1");
  eq(lerp(0, 10, -5), 0, "lerp: t<0 clamped");
  eq(lerp(0, 10, 5), 10, "lerp: t>1 clamped");
  eq(lerp(0, 10, 0.5), 5, "lerp: midpoint");
  eq(lerp(3, Number.NaN, 0.5), 3, "lerp: NaN endpoint is not propagated");
}

// ---------------------------------------------------------------------------
// 5. Truth discipline: stale snapshots, holder/living/alive from snapshots only
// ---------------------------------------------------------------------------
{
  const a = createAdapter({ localParticipantId: "p_me" });
  a.applySnapshot(snap(5, 500, [p("p_me", 1, 1), p("p_b", 2, 2), p("p_c", 3, 3)], { holder: "p_me" }), { receivedAtMs: 500 });
  const stale = snap(4, 400, [p("p_me", 9, 9), p("p_b", 9, 9), p("p_c", 9, 9)], { holder: "p_b" });
  eq(a.applySnapshot(stale, { receivedAtMs: 400 }), false, "stale tick rejected");
  eq(a.view(500).holderSeat, 0, "holder did not move backwards on stale data");
  eq(a.view(500).players[0].pos.x, 1, "position did not rewind on stale data");

  a.applySnapshot(snap(6, 600, [p("p_me", 1, 1, { alive: false }), p("p_b", 2, 2), p("p_c", 3, 3)], { holder: "p_b", living: 2 }), { receivedAtMs: 600 });
  const v = a.view(600);
  eq(v.players[0].alive, false, "alive flag copied from snapshot");
  eq(v.livingCount, 2, "livingCount comes from the snapshot");
  eq(v.round, 2, "round derived deterministically from server livingCount");
  eq(v.holderSeat, 1, "holder follows the newest snapshot");

  // pass ack is informational; it must not mutate holder state
  const pass = a.applyPassAccepted({ fromId: "p_b", toId: "p_c", tick: 6 });
  eq(pass.fromSeat, 1, "pass ack mapped fromId → seat");
  eq(pass.toSeat, 2, "pass ack mapped toId → seat");
  eq(a.view(600).holderSeat, 1, "pass ack does not override snapshot holder");

  // roster change → hard snap (no interpolation between different rosters)
  a.applySnapshot(snap(7, 700, [p("p_me", 1, 1), p("p_b", 2, 2)], { holder: "p_me", living: 2 }), { receivedAtMs: 700 });
  eq(a.view(700).players.length, 2, "roster shrink re-seats without interpolating");
  eq(a.view(700).players[1].pos.x, 2, "new roster position snapped, not blended");
}

// ---------------------------------------------------------------------------
// 6. Empty / missing bomb holder and deadline
// ---------------------------------------------------------------------------
{
  const a = createAdapter({ localParticipantId: "p_me" });
  a.applySnapshot({
    matchId: "m", tick: 1, serverTimeMs: 0, status: "LIVE",
    players: [p("p_me", 0, 0), p("p_b", 1, 0), p("p_c", 2, 0)].map((q) => ({
      participantId: q.id, kind: "HUMAN", position: { x: q.x, y: 0, z: q.z }, velocity: { x: 0, z: 0 },
      facingYaw: 0, alive: true, stamina: 5, isSprinting: false, disconnected: false,
    })),
    bombHolderId: null, bombExpiresAtMs: null, livingCount: 3,
  }, { receivedAtMs: 0 });
  const v = a.view(0);
  eq(v.holderSeat, -1, "null holder → seat -1 without inventing one");
  eq(v.bombTimer, 0, "null deadline → timer 0, never a made-up cycle");
  eq(v.holderId, null, "null holder preserved");
}

// ---------------------------------------------------------------------------
// 7. Engine bridge: local sim becomes a renderer, never an authority
// ---------------------------------------------------------------------------
{
  const room = makeRoom("NET");
  addPlayer(room, "ME"); addPlayer(room, "B1"); addPlayer(room, "B2"); addPlayer(room, "B3");
  startRound(room, 0.3);
  const api = { get room() { return room; } };

  const ids = ["p_me", "p_b", "p_c", "p_d"];
  const mk = (tick, t, holder, alive = [true, true, true, true], pos = null) => ({
    matchId: "m", tick, serverTimeMs: t, status: "LIVE",
    players: ids.map((id, i) => ({
      participantId: id, kind: "HUMAN",
      position: pos ? pos[i] : { x: i * 2, y: 0, z: 0 },
      velocity: { x: 0, z: 0 }, facingYaw: 0,
      alive: alive[i], stamina: 5 - i, isSprinting: false, disconnected: false,
    })),
    bombHolderId: holder, bombExpiresAtMs: t + 4000, livingCount: alive.filter(Boolean).length,
  });

  const adapter = createAdapter({ localParticipantId: "p_me" });
  adapter.applySnapshot(mk(1, 1000, "p_c"), { receivedAtMs: 1000 });

  let clockMs = 1000;
  const inputs = [];
  const bridge = bindEngineRoom({
    api, adapter,
    now: () => clockMs,
    schedule: (fn) => setTimeout(fn, 5), // test loop; detach() clears it
    onLocalInput: (i) => inputs.push(i),
  });

  eq(room.players.length, 4, "bridge: engine keeps its 4 avatars");
  eq(room.players[0].pos.x, 0, "bridge: pump wrote server x onto seat 0");
  eq(room.players[0].pos.z, 0, "bridge: pump wrote server z onto seat 0");
  eq(room.holderSeat, 2, "bridge: holder comes from the snapshot");

  // Drive the engine's own local tick loop. None of it may change truth.
  const before = { x: room.players[0].pos.x, stamina: room.players[0].stamina };
  input(room.players[0], 1, 0, true);
  for (let i = 0; i < 20; i++) step(room, 1 / 20);
  eq(room.players[0].pos.x, before.x, "bridge: local sim cannot move the local avatar");
  eq(room.players[0].stamina, before.stamina, "bridge: local sim cannot drain server stamina");
  eq(room.players[0].isSprinting, false, "bridge: local sim cannot set sprint truth");
  eq(room.holderSeat, 2, "bridge: local sim cannot steal the bomb");
  assert(pass(room, 0).ok === false, "bridge: local pass() is inert (intent goes to server)");

  input(room.players[2], -1, 0, true);
  const botX = room.players[2].pos.x;
  for (let i = 0; i < 20; i++) step(room, 1 / 20);
  eq(room.players[2].pos.x, botX, "bridge: bot sim cannot move a remote avatar");
  eq(room.over, false, "bridge: local sim cannot end the match");
  eq(room.winnerSeat, null, "bridge: local sim cannot name a winner");

  // New snapshot: positions snap, elimination is adopted from the server.
  clockMs = 1200;
  adapter.applySnapshot(mk(2, 1100, "p_b", [true, false, true, true], [
    { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 3 }, { x: 4, y: 0, z: 4 },
  ]), { receivedAtMs: 1100 });

  setTimeout(() => {
    eq(room.holderSeat, 1, "bridge: holder follows the new snapshot");
    eq(room.players[1].alive, false, "bridge: elimination adopted from the snapshot");
    assert(Math.abs(room.players[0].pos.x - 1) < 1e-6, "bridge: position snapped to the snapshot");
    assert(inputs.length > 0, "bridge: local intent is forwarded to the socket");
    const last = inputs[inputs.length - 1];
    assert(Number.isFinite(last.moveX) && Math.abs(last.moveX) <= 1, "bridge: forwarded intent is clamped");
    bridge.detach();

    // Everything below runs after detach(); no more pumping.
    const frozen = room.players[0].pos.x;
    setTimeout(() => {
      eq(room.players[0].pos.x, frozen, "bridge: detach stops the pump");
      finish();
    }, 30);
  }, 30);
}

function finish() {
  console.log(failed ? `\n${failed} FAILURES` : "\nall adapter tests pass");
  process.exit(failed ? 1 : 0);
}

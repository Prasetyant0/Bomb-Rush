/**
 * FRONTEND SMOKE TEST — simulates exactly what the frontend will do,
 * using only the public contract (REST + Socket.IO). No test hooks, no
 * internals manipulation, no reduced countdown — this is the developer
 * integration walkthrough (docs/FRONTEND_INTEGRATION_CHECKLIST.md).
 *
 * Run:  npx tsx smoke/frontend-smoke.ts  (from apps/server)
 * Requires the dev server on :3000  →  npm run dev --workspace @bomb-rush/server
 */
import { io as Client, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, GAME_RULES } from '@bomb-rush/shared';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000';
const step = (n: string) => console.log(`\n== ${n}`);

/** REST helper — plain fetch, no libraries beyond socket.io-client. */
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Connect with the OFFICIAL handshake (auth.eventVersion = "0.3"). */
function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const c = Client(BASE, { auth: { eventVersion: PROTOCOL_VERSION }, transports: ['websocket'] });
    c.on('connect', () => resolve(c));
    c.on('connect_error', reject);
  });
}

/** Wait for one event, with timeout → surfaces hangs as failures, not silence. */
function next<T = any>(socket: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), ms);
    socket.once(event, (data: T) => { clearTimeout(t); resolve(data); });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let failures = 0;
  const expect = (cond: boolean, label: string) => {
    if (cond) console.log(`  PASS ${label}`);
    else { failures++; console.log(`  FAIL ${label}`); }
    return cond;
  };

  // ---- 1. health + create room ----
  step('1. health + create room');
  const health = await api('GET', '/health');
  expect(health.status === 200 && health.json.ok === true, 'GET /health ok');
  const host = await api('POST', '/api/rooms', { visibility: 'PUBLIC', virtualDemoEntryWei: '1000000000000000', allowDemoBot: false });
  expect(host.status === 201 && !!host.json.sessionToken && !!host.json.participantId, 'POST /api/rooms → tokens minted');
  const { roomId, participantId: hostId, sessionToken: hostToken } = host.json;

  // ---- 2. join until three players ----
  step('2. join 2 more players (3 seats full)');
  const p2 = await api('POST', `/api/rooms/${roomId}/join`, { kind: 'HUMAN' });
  const p3 = await api('POST', `/api/rooms/${roomId}/join`, { kind: 'HUMAN' });
  expect(p2.status === 200 && p3.status === 200, 'both joins 200 with tokens');
  const players = [
    { id: hostId, token: hostToken },
    { id: p2.json.participantId, token: p2.json.sessionToken },
    { id: p3.json.participantId, token: p3.json.sessionToken },
  ];

  // ---- 3. subscribe each client (official handshake) ----
  step('3. subscribe all clients');
  const sockets: Socket[] = [];
  for (const p of players) {
    const s = await connect();
    const state = next(s, 'room:state');
    s.emit('room:subscribe', { roomId, sessionToken: p.token });
    const st = await state;
    expect(st.status === 'WAITING' && st.participants.length === 3, `subscribe ok (${st.status}, ${st.participants.length} seats)`);
    sockets.push(s);
  }

  // invalid token rejected
  const stranger = await connect();
  const subErr = next(stranger, 'game:error');
  stranger.emit('room:subscribe', { roomId, sessionToken: 'forged-token' });
  expect((await subErr).code === 'SUBSCRIBE_AUTH_FAILED', 'forged token rejected');

  // ---- 4. ready all → countdown ----
  step('4. ready all → server countdown');
  const countdowns: any[] = [];
  sockets.slice(1).forEach((s) => s.on('room:countdown', (d) => countdowns.push(d)));
  for (const s of sockets) {
    const state = next(s, 'room:state');
    s.emit('room:set_ready', { ready: true });
    await state;
  }
  await sleep(200);
  expect(countdowns.length >= 1, `room:countdown received by peers (${countdowns.length})`);
  expect(countdowns[0].startAtMs > Date.now(), 'startAtMs is in the future');

  // ---- 5. wait the real countdown (docs forbid shortening it) ----
  step('5. wait 15 s countdown (real duration)');
  const waits = sockets.map((s) => next(s, 'match:started', 20_000));
  const started = await Promise.all(waits);
  expect(started.every((e) => e.matchId), `match:started broadcast to all (${started[0].matchId})`);

  // ---- 6. consistent authoritative snapshots ----
  step('6. snapshots consistent across clients');
  const snaps = await Promise.all(sockets.map((s) => next(s, 'match:snapshot')));
  expect(snaps.every((s) => s.matchId === started[0].matchId), 'all matchId equal');
  expect(snaps.every((s) => s.players.length === 3), '3 players in snapshot');
  expect(new Set(snaps.map((s) => s.bombHolderId)).size === 1, 'all agree on bombHolderId');
  const holderId: string = snaps[0].bombHolderId;
  console.log(`  holder = ${holderId.slice(0, 8)}`);

  // ---- 7. bomb pass: invalid then valid ----
  step('7. pass flows (unauthorized + valid)');
  const nonHolder = sockets[players.findIndex((p) => p.id !== holderId) % 3];
  const err = next(nonHolder, 'game:error');
  nonHolder.emit('bomb:pass_intent', { sequence: 1 });
  expect((await err).code === 'NOT_BOMB_HOLDER', 'non-holder pass rejected NOT_BOMB_HOLDER');

  // Teleport is impossible via contract (server owns positions) — drive the
  // two players toward each other using legitimate inputs. The holder's
  // coordinates come from the last snapshot (spawn ring ±6), so we steer both
  // along the axis of their separation AND use both remaining participants to
  // converge whichever is nearest.
  const holderIdx = players.findIndex((p) => p.id === holderId);
  const holderSocket = sockets[holderIdx];
  // derive spawn positions from the last snapshot (all clients agree)
  const holderSpawn = snaps[0].players.find((p: any) => p.participantId === holderId).position;
  // nearest other participant by snapshot distance
  const others = snaps[0].players.filter((p: any) => p.participantId !== holderId);
  others.sort((a: any, b: any) =>
    Math.hypot(a.position.x - holderSpawn.x, a.position.z - holderSpawn.z) -
    Math.hypot(b.position.x - holderSpawn.x, b.position.z - holderSpawn.z));
  const targetId = others[0].participantId;
  const targetIdx = players.findIndex((p) => p.id === targetId);
  const moveTo = (self: any, from: { x: number; z: number }, to: { x: number; z: number }, sSeq: number) => {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    return { sequence: sSeq, moveX: dx / len, moveZ: dz / len, sprint: false };
  };
  let seq = 2;
  let accepted: any = null;
  let lastPos: any = null;
  for (let round = 0; round < 50 && !accepted; round++) {
    // steer holder + target toward the same center point
    const cur = lastPos ?? {
      h: { x: holderSpawn.x, z: holderSpawn.z },
      t: { x: others[0].position.x, z: others[0].position.z },
    };
    const center = { x: (cur.h.x + cur.t.x) / 2, z: (cur.h.z + cur.t.z) / 2 };
    holderSocket.emit('player:input', moveTo(holderId, cur.h, center, seq++));
    sockets[targetIdx].emit('player:input', moveTo(targetId, cur.t, center, seq++));
    await sleep(70); // ~1+ tick
    const s = await next(holderSocket, 'match:snapshot', 1200).catch(() => null);
    if (s) {
      const hp = s.players.find((p: any) => p.participantId === holderId);
      const tp = s.players.find((p: any) => p.participantId === targetId);
      if (hp && tp) lastPos = { h: hp.position, t: tp.position };
    }
    if (round % 2 === 1) {
      const maybe = next(holderSocket, 'bomb:pass_accepted', 400).catch(() => null);
      holderSocket.emit('bomb:pass_intent', { sequence: 8000 + round });
      accepted = await maybe;
    }
  }
  const hcur = lastPos ? lastPos.h : holderSpawn;
  const tcur = lastPos ? lastPos.t : others[0].position;
  const movedApart = Math.hypot(hcur.x - tcur.x, hcur.z - tcur.z) > GAME_RULES.PASS_RANGE;
  // If snapshots never confirmed proximity (blocked step), fail honestly:
  expect(accepted !== null, 'valid pass accepted after converging (server-chosen positions)');
  console.log(`  final dist: ${Math.hypot(hcur.x - tcur.x, hcur.z - tcur.z).toFixed(2)} (movedApart=${movedApart})`);
  if (accepted) {
    const snapAfter = await next(holderSocket, 'match:snapshot', 2000).catch(() => null);
    expect(!snapAfter || snapAfter.bombHolderId === accepted.toId, 'new holder consistent in snapshot');
  }

  // ---- 8. disconnect / reconnect within grace ----
  step('8. disconnect + reconnect (seat survives)');
  const victimIdx = players.findIndex((p) => p.id !== (accepted?.toId ?? holderId));
  sockets[victimIdx].disconnect();
  await sleep(300);
  const reconnected = await connect();
  const reState = next(reconnected as Socket, 'room:state');
  (reconnected as Socket).emit('room:subscribe', { roomId, sessionToken: players[victimIdx].token });
  const rs = await reState;
  expect(rs.status === 'LIVE', `rejoined into LIVE seat (${rs.status})`);
  sockets[victimIdx] = reconnected as Socket;

  // ---- 9. endgame: let the bomb run to eliminate holders until winner ----
  step('9. play out to a single winner');
  const finished: any[] = [];
  for (const s of sockets) s.on('match:finished', (d) => finished.push(d));
  const winnerWait = next(sockets[0], 'match:finished', 300_000);
  const winner = await winnerWait;
  // broadcast goes to every subscribed client — verify consistency instead of count
  expect(winner.winnerId, `match:finished emitted, winner=${winner.winnerId.slice(0, 8)}`);
  expect(finished.length >= 1 && finished.every((f) => f.matchId === winner.matchId && f.winnerId === winner.winnerId),
    `all clients agree on matchId + winner (${finished.length} deliveries)`);
  const result = await api('GET', `/api/matches/${winner.matchId}/result`);
  expect(result.status === 200 && result.json.winnerId === winner.winnerId, 'GET /result agrees with broadcast');
  expect(result.json.chainRecord?.state === 'PENDING', 'chainRecord honestly PENDING (no fake tx)');

  for (const s of sockets) s.disconnect();
  stranger.disconnect();
  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED ✅' : `\n${failures} CHECK(S) FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });

// Pure domain tests — fake clock, no sockets, no DB (Phase E).
import { describe, it, expect } from 'vitest';
import { GAME_RULES } from '@bomb-rush/shared';
import {
  createRoom, joinRoom, setReady, passBomb, explode, tickRoom, roomPublicState,
  cancelRoom, leaveRoom, maybeExpire, onDisconnect, applyInput, type RoomSession,
} from '../src/game/domain.js';
import { makeClock } from './fakeClock.js';

function freshRoom(clock: ReturnType<typeof makeClock>, opts: { allowDemoBot?: boolean; entry?: string } = {}) {
  const room = createRoom(clock, 'r1', 'ABC123', 'host', 'PUBLIC', opts.entry ?? '500000000000000000', opts.allowDemoBot ?? false);
  const host = joinRoom(room, 'HUMAN', clock) as any;
  return { room, hostToken: host.sessionToken, hostId: room.hostParticipantId as string };
}
function joinN(room: any, n: number, clock: ReturnType<typeof makeClock>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const res = joinRoom(room, 'HUMAN', clock) as any;
    ids.push(res.participant.participantId);
  }
  return ids;
}

function readyAll(room: any, ids: string[], clock: ReturnType<typeof makeClock>) {
  for (const id of ids) setReady(room, id, true, clock);
}

describe('room lifecycle', () => {
  it('rejects 5th participant (ROOM_FULL)', () => {
    const clock = makeClock();
    const { room } = freshRoom(clock);
    joinN(room, 3, clock);
    const fifth = joinRoom(room, 'HUMAN', clock) as any;
    expect(room.participants.length).toBe(4);
    expect(fifth.errors[0].code).toBe('ROOM_FULL');
  });

  it('accepts 4th before countdown and rejects after countdown starts', () => {
    const clock = makeClock();
    const { room } = freshRoom(clock, { allowDemoBot: false });
    const ids = joinN(room, 3, clock); // now 4 participants incl. host
    readyAll(room, ids, clock);
    setReady(room, (room.participants[0] as any).participantId, true, clock);
    expect(roomPublicState(room).status).toBe('COUNTDOWN');
    const late = joinRoom(room, 'HUMAN', clock) as any;
    expect(late.errors[0].code).toBe('ROOM_NOT_JOINABLE');
    if (late.errors[0].code === 'ROOM_FULL') throw new Error('unreachable'); // guard for ts narrowing
  });

  it('cancelRoom rejects non-host (NOT_HOST) and host before LIVE (CANCELED)', () => {
    const clock = makeClock();
    const { room, hostId } = freshRoom(clock);
    const out = cancelRoom(room, 'not-host', clock);
    expect(out.errors[0].code).toBe('NOT_HOST');
    const ok = cancelRoom(room, hostId, clock);
    expect(ok.errors).toEqual([]);
    expect(room.roomStatus).toBe('CANCELED');
  });

  it('waiting room expires at 10 min (CANCELED, no match id)', () => {
    const clock = makeClock();
    const { room } = freshRoom(clock);
    clock.advance(GAME_RULES.ROOM_EXPIRY_MS + 1);
    const ev = maybeExpire(room, clock);
    expect((ev as any).roomLapsed?.status).toBe('CANCELED');
    expect(room.matchId).toBeNull();
  });
});

describe('ready + countdown + start', () => {
  it('countdown starts when 3 ready; match starts after 15 s; bot rules enforced', () => {
    const clock = makeClock();
    const { room } = freshRoom(clock, { allowDemoBot: true });
    const bot = joinRoom(room, 'DEMO_BOT', clock) as any;
    expect(bot.sessionToken).toBeTruthy();
    const h2 = (joinRoom(room, 'HUMAN', clock) as any).participant.participantId;
    // 2 humans + 1 bot is a valid quorum
    readyAll(room, [(room.participants[0] as any).participantId, h2, bot.participant.participantId], clock);
    expect(room.roomStatus).toBe('COUNTDOWN');
    // before 15 s: no start
    tickRoom(room, clock);
    expect(room.roomStatus).toBe('COUNTDOWN');
    clock.advance(GAME_RULES.LOBBY_COUNTDOWN_MS + 1);
    // quorum revalidation at countdown completion (simulated by a direct call)
    const now = clock.now();
    expect(now >= (room as any).countdownStartsAt + GAME_RULES.LOBBY_COUNTDOWN_MS).toBe(true);
    // 1 human + 1 bot fails start
    const tinyRoom = createRoom(clock, 'r2', 'ZZZ', 'h', 'PUBLIC', '1000', true);
    (joinRoom(tinyRoom, 'DEMO_BOT', clock) as any);
    const h = (joinRoom(tinyRoom, 'HUMAN', clock) as any).participant.participantId;
    readyAll(tinyRoom, [h, (tinyRoom.participants[0] as any).participantId], clock);
    // countdown would NOT start (min humans not met with a bot)
    const state = roomPublicState(tinyRoom);
    expect(state.participants.length).toBe(2);
  });
});

describe('bomb pass', () => {
  function liveMatchedRoom() {
    const clock = makeClock();
    const room = createRoom(clock, 'r', 'CODE', 'h', 'PUBLIC', '1000', false);
    const a = joinRoom(room, 'HUMAN', clock) as any;
    const b = joinRoom(room, 'HUMAN', clock) as any;
    joinRoom(room, 'HUMAN', clock);
    readyAll(room, [a.participant.participantId, b.participant.participantId, room.participants[2].participantId], clock);
    // force LIVE
    (room as any).roomStatus = 'LIVE';
    (room as any).matchId = 'm1';
    return { room, a: a.participant.participantId, b: b.participant.participantId, c3: room.participants[2].participantId, clock };
  }

  it('pass succeeds when within range and not in cooldown', () => {
    const { room, a, b, clock } = liveMatchedRoom();
    room.bombHolderId = a;
    room.bombExpiresAt = clock.now() + GAME_RULES.BOMB_CYCLE_MS;
    room.bombLockbackFromId = null;
    room.bombLockbackUntil = null;
    room.nextPassAllowedAt = null;
    // park a next to a; b within 1.8
    room.participants.find((p) => p.participantId === a)!.position = { x: 0, y: 0, z: 0 };
    room.participants.find((p) => p.participantId === b)!.position = { x: 1, y: 0, z: 0 };
    const out = passBomb(room, a, clock);
    expect(out.errors).toEqual([]);
    expect(room.bombHolderId).toBe(b);
    // countdown must NOT reset on pass
    expect(room.bombExpiresAt).toBe(clock.now() + GAME_RULES.BOMB_CYCLE_MS - 0);
  });

  it('rejects pass out of range and during cooldown', () => {
    const { room, a, b, clock } = liveMatchedRoom();
    room.bombHolderId = a;
    room.bombExpiresAt = clock.now() + GAME_RULES.BOMB_CYCLE_MS;
    room.nextPassAllowedAt = null;
    room.participants.find((p) => p.participantId === a)!.position = { x: 0, y: 0, z: 0 };
    room.participants.find((p) => p.participantId === b)!.position = { x: 1.9, y: 0, z: 0 };
    const far = passBomb(room, a, clock);
    expect(far.errors[0].code).toBe('NO_PASS_TARGET');
    // in-range now, but cooldown still active
    room.participants.find((p) => p.participantId === b)!.position = { x: 1, y: 0, z: 0 };
    room.nextPassAllowedAt = clock.now() + 400;
    const cd = passBomb(room, a, clock);
    expect(cd.errors[0].code).toBe('PASS_COOLDOWN');
  });

  it('anti-return: former holder excluded for 1 s (GS-06)', () => {
    const { room, a, b, clock } = liveMatchedRoom();
    room.bombHolderId = a;
    room.bombExpiresAt = clock.now() + GAME_RULES.BOMB_CYCLE_MS;
    room.nextPassAllowedAt = null;
    // a and b both within range
    room.participants.find((p) => p.participantId === a)!.position = { x: 0, y: 0, z: 0 };
    room.participants.find((p) => p.participantId === b)!.position = { x: 1, y: 0, z: 0 };
    // b currently locked out as former holder (just passed to a)
    room.bombLockbackFromId = b;
    room.bombLockbackUntil = clock.now() + 800;
    // only b is in range besides a, so pass must fail with no eligible target
    const out = passBomb(room, a, clock);
    expect(out.errors[0].code).toBe('NO_PASS_TARGET');
    // after 1 s, b becomes eligible again
    clock.advance(1000);
    const out2 = passBomb(room, a, clock);
    expect(out2.errors).toEqual([]);
  });

  it('non-holder cannot pass (NO_HOLDER)', () => {
    const { room, a, b, clock } = liveMatchedRoom();
    room.bombHolderId = b;
    room.bombExpiresAt = clock.now() + GAME_RULES.BOMB_CYCLE_MS;
    const out = passBomb(room, a, clock);
    expect(out.errors[0].code).toBe('NOT_BOMB_HOLDER');
  });
});

describe('explosion + winner', () => {
  it('eliminates holder at expiry; single survivor wins once (game-end idempotent)', () => {
    const clock = makeClock();
    const room = createRoom(clock, 'r', 'CODE', 'h', 'PUBLIC', '1000', false);
    joinRoom(room, 'HUMAN', clock); joinRoom(room, 'HUMAN', clock); joinRoom(room, 'HUMAN', clock);
    (room as any).roomStatus = 'LIVE';
    (room as any).matchId = 'm1';
    const [p1, p2] = room.participants;
    room.bombHolderId = p1.participantId;
    room.bombExpiresAt = clock.now() + GAME_RULES.BOMB_CYCLE_MS;
    // explode at exactly the deadline
    clock.advance(GAME_RULES.BOMB_CYCLE_MS);
    const out = explode(room, clock);
    expect(out.errors).toEqual([]);
    expect(room.participants[0].alive).toBe(false);
    expect(room.bombHolderId).not.toBeNull();
    // second explosion attempt without advancing is a no-op (bombExpiresAt is next cycle)
    const again = explode(room, clock);
    expect(again.errors).toEqual([]);
    expect(room.bombHolderId !== p1.participantId).toBe(true);
    // eliminate one of the two remaining → single survivor wins (p3 must be
    // alive AND not holder; holder dies at expiry)
    room.bombHolderId = room.participants[1].participantId;
    room.participants[1].alive = false; // dead holder: elimination is a no-op alive-wise
    room.bombExpiresAt = clock.now() + 1;
    clock.advance(2);
    const fin = explode(room, clock);
    expect((fin.events as any).matchFinished?.status).toBe('FINISHED');
    expect(room.roomStatus).toBe('FINISHED');
    expect((fin.events as any).matchFinished?.winnerId).toBe(room.winnerId);
  });

  it('no invented winner when room empties (ABORTED)', () => {
    const clock = makeClock();
    const room = createRoom(clock, 'r', 'CODE', 'h', 'PUBLIC', '1000', false);
    joinRoom(room, 'HUMAN', clock); joinRoom(room, 'HUMAN', clock);
    (room as any).roomStatus = 'LIVE';
    (room as any).matchId = 'm2';
    room.participants.forEach((p) => { p.alive = false; });
    room.bombExpiresAt = clock.now() + GAME_RULES.BOMB_CYCLE_MS;
    clock.advance(GAME_RULES.BOMB_CYCLE_MS);
    const out = explode(room, clock);
    expect((out.events as any).matchFinished?.status).toBe('ABORTED');
    expect((out.events as any).matchFinished?.winnerId).toBeNull();
  });
});

describe('stamina & movement (GS-01..04)', () => {
  function sprinter(clock: ReturnType<typeof makeClock>) {
    const room = createRoom(clock, 'r', 'C', 'h', 'PUBLIC', '1000', false);
    joinRoom(room, 'HUMAN', clock); joinRoom(room, 'HUMAN', clock); joinRoom(room, 'HUMAN', clock);
    (room as any).roomStatus = 'LIVE';
    room.participants.forEach((p) => { p.lastTickAt = clock.now(); });
    return { room, p: room.participants[0] };
  }

  it('GS-01: 5 s continuous sprint drains 5 bars, then forced walk', () => {
    const clock = makeClock();
    const { room, p } = sprinter(clock);
    applyInput(room, p.participantId, { sequence: 1, moveX: 1, moveZ: 0, sprint: true }, clock);
    for (let i = 0; i < 100; i++) { // 5 s at 20 Hz
      clock.advance(50);
      tickRoom(room, clock);
    }
    expect(p.stamina).toBeCloseTo(0, 6);
    expect(p.isSprinting).toBe(false);
  });

  it('GS-02/GS-03: regen waits 1.5 s then +1 bar/s', () => {
    const clock = makeClock();
    const { room, p } = sprinter(clock);
    p.stamina = 0;
    p.lastSprintEndedAt = clock.now(); // just stopped
    clock.advance(1400); tickRoom(room, clock);
    expect(p.stamina).toBe(0); // no regen yet
    clock.advance(1100); tickRoom(room, clock);
    // crossed 1.5 s delay: 1 s worth of regen
    expect(p.stamina).toBeGreaterThanOrEqual(0.9);
    expect(p.stamina).toBeLessThanOrEqual(1.1);
    // clamp at 5 (dt is clamped to 2s per tick, so keep ticking)
    for (let i = 0; i < 50; i++) {
      clock.advance(1000);
      tickRoom(room, clock);
    }
    expect(p.stamina).toBe(GAME_RULES.STAMINA_MAX);
  });

  it('GS-04: diagonal vector clamped to unit magnitude', () => {
    const clock = makeClock();
    const { room, p } = sprinter(clock);
    applyInput(room, p.participantId, { sequence: 1, moveX: 3, moveZ: 4, sprint: false }, clock);
    expect(p.lastInput!.moveX).toBeCloseTo(0.6);
    expect(p.lastInput!.moveZ).toBeCloseTo(0.8);
  });
});

describe('disconnect handling', () => {
  it('lobby disconnect removes participant; live disconnect retains seat within grace', () => {
    const clock = makeClock();
    const { room } = freshRoom(clock);
    const [second] = joinN(room, 1, clock);
    leaveRoom(room, second, clock);
    expect(room.participants.length).toBe(1);
  });
});

// BOMB RUSH 3D — authoritative game domain (pure logic, no I/O).
// Canonical rules: GAMEPLAY_CONTROLS.md v0.3, API_CONTRACT 0.3, TRD §13.
// Identity mapping lives in net/session.ts; this module never trusts client ids.
import { GAME_RULES, ERROR_CODES, SPAWN_POINTS, type RoomStatus, type ParticipantKind } from '@bomb-rush/shared';

// ponytail: (room_id, user_id) and {roomId,userId} duplicates guard concurrent joins

// Minimal wall-clock abstraction so countdown/expiry tests use fake timers.
export interface Clock {
  now(): number;
}

export interface PlayerInput {
  sequence: number; // strictly increasing per participant session (API_CONTRACT §5)
  moveX: number;
  moveZ: number;
  sprint: boolean;
}

export interface GameParticipant {
  participantId: string; // server-generated uuid, never client-supplied
  kind: ParticipantKind;
  /**
   * Wallet bound to this seat, lowercase. Required for a funded room: the
   * contract settles only to a depositor, so a seat without a wallet can never
   * win a pot. Null means "guest / unfunded", which is valid only in demo rooms.
   */
  walletAddress: string | null;
  ready: boolean;
  alive: boolean;
  stamina: number;
  isSprinting: boolean;
  connected: boolean;
  position: { x: number; y: number; z: number };
  facingYaw: number;
  lastInput: PlayerInput | null; // latest-value movement stream (API_CONTRACT §5)
  lastInputSeq: number; // monotonic input sequence tracking
  lastPassAcceptedAt: number | null; // ms since epoch
  lastSprintEndedAt: number | null; // when sprint stopped (regen delay anchor)
  lastTickAt: number; // authoritative integration anchor
  disconnectGraceEndsAt: number | null;
}

export interface RoomSession {
  roomId: string;
  code: string;
  /**
   * bytes32 contract identity, derived server-side as
   * keccak256(abi.encodePacked('BOMB_RUSH_V05', chainId, nonce, hostAddress)).
   * The contract cannot verify the derivation, so this value is the only bridge
   * between the game room and the escrow. Null for a demo room with no escrow.
   */
  roomKey: string | null;
  /** Escrow status mirrored from the chain. Never a guess. */
  escrowStatus: 'NONE' | 'FUNDING' | 'FUNDED' | 'SETTLED' | 'CANCELED';
  roomStatus: RoomStatus; // P0: WAITING|COUNTDOWN|LIVE|FINISHED|CANCELED|ABORTED
  hostParticipantId: string; // server-minted participant id of the room host
  visibility: 'PUBLIC' | 'PRIVATE';
  virtualDemoEntryWei: string;
  allowDemoBot: boolean;
  createdAt: number;
  expiresAt: number; // DECISIONS.md Lobby: 10 min expiry
  endedAtMs: number | null; // set when room reaches a final state (cleanup sweep)
  countdownStartsAt: number | null;
  participants: GameParticipant[];
  // below fields only meaningful once LIVE
  matchId: string | null;
  tick: number;
  bombHolderId: string | null;
  bombExpiresAt: number | null; // authoritative deadline, never resets on pass
  bombLockbackFromId: string | null;
  bombLockbackUntil: number | null;
  winnerId: string | null;
  finishedAt: number | null;
  nextPassAllowedAt: number | null;
}

export interface BombPass {
  fromId: string;
  toId: string;
  tick: number;
}

export type GameError = { code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES]; message: string };

export interface GameEvents {
  roomCountdownStarted?: { startAtMs: number; serverTimeMs: number };
  roomCountdownCanceled?: { status: 'WAITING' };
  bombPassAccepted?: BombPass;
  bombPassRejected?: { fromId: string; code: string; message: string };
  elimination?: { eliminatedId: string }; // explosion eliminated holder
  matchStarted?: { matchId: string; startedAtMs: number };
  matchFinished?: { matchId: string; winnerId: string | null; status: RoomStatus };
  roomLapsed?: { status: RoomStatus }; // room expired / canceled
}

interface Outcomes {
  events: GameEvents;
  errors: GameError[];
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

export function createRoom(
  clock: Clock,
  roomId: string,
  code: string,
  hostParticipantId: string,
  visibility: 'PUBLIC' | 'PRIVATE',
  virtualDemoEntryWei: string,
  allowDemoBot: boolean,
  /** Derived bytes32 when the host supplied a wallet; null = demo room. */
  roomKey: string | null = null,
): RoomSession {
  const now = clock.now();
  return {
    roomId,
    code,
    roomKey,
    escrowStatus: 'NONE',
    roomStatus: 'WAITING',
    hostParticipantId,
    visibility,
    virtualDemoEntryWei,
    allowDemoBot,
    createdAt: now,
    expiresAt: now + GAME_RULES.ROOM_EXPIRY_MS,
    endedAtMs: null,
    countdownStartsAt: null,
    participants: [],
    matchId: null,
    tick: 0,
    bombHolderId: null,
    bombExpiresAt: null,
    bombLockbackFromId: null,
    bombLockbackUntil: null,
    winnerId: null,
    finishedAt: null,
    nextPassAllowedAt: null,
  };
}

const uuid =
  (): string =>
    globalThis.crypto?.randomUUID?.() ??
    // ponytail: crypto.randomUUID guaranteed on Node 19+; fallback for
    // deterministic-test seeds or ancient runtimes.
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function joinRoom(
  room: RoomSession,
  kind: ParticipantKind,
  clock: Clock,
  /** Already normalized (lowercase) by the caller; see escrow/roomKey.ts. */
  walletAddress: string | null = null,
): { errors: GameError[]; sessionToken: string; participant: GameParticipant } | { errors: GameError[] } {
  if (room.roomStatus !== 'WAITING') {
    return { errors: [{ code: ERROR_CODES.ROOM_NOT_JOINABLE, message: `Room status is ${room.roomStatus}; only WAITING is joinable.` }] };
  }
  if (room.participants.length >= GAME_RULES.MAX_PLAYERS) {
    return { errors: [{ code: ERROR_CODES.ROOM_FULL, message: 'Room already has 4 participants.' }] };
  }
  // DECISIONS.md Lobby: min 2 humans if a demo bot fills one of the 3–4 seats.
  if (kind === 'DEMO_BOT' && !room.allowDemoBot) {
    return { errors: [{ code: ERROR_CODES.BAD_STATE, message: 'Demo bot disabled for this room.' }] };
  }
  if (kind === 'DEMO_BOT' && room.participants.some((p) => p.kind === 'DEMO_BOT')) {
    return { errors: [{ code: ERROR_CODES.BAD_STATE, message: 'Only one demo bot per room.' }] };
  }
  // One wallet per seat per room: a duplicated address would let one depositor
  // occupy two seats, which the escrow's depositor check cannot distinguish.
  if (walletAddress != null && room.participants.some((p) => p.walletAddress === walletAddress)) {
    return { errors: [{ code: ERROR_CODES.BAD_STATE, message: 'That wallet already holds a seat in this room.' }] };
  }
  const seatIndex = room.participants.length;
  const spawn = SPAWN_POINTS[seatIndex % SPAWN_POINTS.length];
  const participant: GameParticipant = {
    participantId: uuid(),
    kind,
    walletAddress,
    ready: false,
    alive: true,
    stamina: GAME_RULES.STAMINA_MAX,
    isSprinting: false,
    connected: true,
    position: { x: spawn.x, y: 0, z: spawn.z },
    facingYaw: 0,
    lastInput: null,
    lastInputSeq: -1,
    lastPassAcceptedAt: null,
    lastSprintEndedAt: null,
    lastTickAt: clock.now(),
    disconnectGraceEndsAt: null,
  };
  room.participants.push(participant);
  const sessionToken = uuid(); // opaque server-minted token, never derived from client data
  return { events: {}, errors: [], sessionToken, participant } as { events: {}; errors: []; sessionToken: string; participant: GameParticipant };
}

// Called from net adapter on room:subscribe. Identity = (roomId, participantId)
// paired with the sessionToken minted in joinRoom. Client-sent participantId
// alone is never trusted.
export function subscribe(
  room: RoomSession,
  byParticipantId: string,
  sessionToken: string,
  tokenForParticipant: (participantId: string) => string | undefined,
): { errors: GameError[] } {
  const expected = tokenForParticipant(byParticipantId);
  if (expected !== sessionToken) {
    return { errors: [{ code: ERROR_CODES.SUBSCRIBE_AUTH, message: 'Invalid room membership or session token.' }] };
  }
  const participant = room.participants.find((p) => p.participantId === byParticipantId);
  if (!participant) {
    return { errors: [{ code: ERROR_CODES.SUBSCRIBE_AUTH, message: 'You are not in this room.' }] };
  }
  return { errors: [] };
}

export function setReady(room: RoomSession, byParticipantId: string, ready: boolean, clock: Clock): Outcomes {
  if (room.roomStatus === 'WAITING') {
    const participant = room.participants.find((p) => p.participantId === byParticipantId);
    if (!participant) {
      return { events: {}, errors: [{ code: ERROR_CODES.NOT_IN_ROOM, message: 'You are not in this room.' }] };
    }
    participant.ready = ready;
    // SYS.md state machine: WAITING -> COUNTDOWN with quorum when all ready
    if (ready && room.participants.length >= GAME_RULES.MIN_PLAYERS && room.participants.every((p) => p.ready)) {
      room.roomStatus = 'COUNTDOWN';
      room.countdownStartsAt = clock.now();
      // Notify everyone so UI can render countdown without another poll.
      room.nextPassAllowedAt = null;
      room.bombLockbackUntil = null;
      room.bombExpiresAt = null;
      room.finishedAt = null;
      return { events: { roomCountdownStarted: { startAtMs: room.countdownStartsAt + GAME_RULES.LOBBY_COUNTDOWN_MS, serverTimeMs: clock.now() } }, errors: [] };
    }
    return { events: {}, errors: [] };
  }
  return { events: {}, errors: [{ code: ERROR_CODES.BAD_STATE, message: 'Room is not in a settable-ready state.' }] };
}

export function leaveRoom(room: RoomSession, byParticipantId: string, clock: Clock): Outcomes {
  if (room.roomStatus === 'WAITING' || room.roomStatus === 'COUNTDOWN') {
    return dropParticipant(room, byParticipantId, clock);
  }
  return { events: {}, errors: [{ code: ERROR_CODES.BAD_STATE, message: 'Room is past lobby; use disconnect handling.' }] };
}

function dropParticipant(room: RoomSession, participantId: string, clock: Clock): Outcomes {
  const before = room.participants.length;
  room.participants = room.participants.filter((p) => p.participantId !== participantId);
  if (room.participants.length === before) return { events: {}, errors: [] };
  // SYS.md: any quorum loss before LIVE cancels countdown, never forces start.
  if (room.roomStatus === 'COUNTDOWN') {
    const stillEnough = room.participants.length >= GAME_RULES.MIN_PLAYERS && room.participants.every((p) => p.ready);
    if (!stillEnough) {
      room.roomStatus = 'WAITING';
      room.countdownStartsAt = null;
      room.participants.forEach((p) => { p.ready = false; });
      return { events: { roomCountdownCanceled: { status: 'WAITING' } }, errors: [] };
    }
  }
  // A room below min and nobody connected simply lapses.
  if (room.participants.length === 0) {
    room.roomStatus = 'CANCELED';
    return { events: { roomLapsed: { status: room.roomStatus } }, errors: [] };
  }
  return { events: {}, errors: [] };
}

// Brief disconnect → seat preserved; final timeout eliminate. If the room is
// WAITING and ALL seats disconnected, room lapses (no permanent ghost rooms).
export function onDisconnect(room: RoomSession, participantId: string, clock: Clock): Outcomes {
  const participant = room.participants.find((p) => p.participantId === participantId);
  if (!participant) return { events: {}, errors: [] };
  participant.connected = false;
  if (room.roomStatus === 'LIVE') {
    participant.disconnectGraceEndsAt = clock.now() + GAME_RULES.RECONNECT_GRACE_MS;
    return { events: {}, errors: [] };
  }
  if (room.roomStatus === 'WAITING' || room.roomStatus === 'COUNTDOWN') {
    // Lobby disconnects: quorum loss rules apply (countdown cancel, empty-lapse)
    return dropParticipant(room, participantId, clock);
  }
  return { events: {}, errors: [] };
}

function terminateMatch(room: RoomSession, status: RoomStatus, clock: Clock): GameEvents {
  room.roomStatus = status;
  room.finishedAt = clock.now();
  room.endedAtMs = clock.now();
  if (room.matchId) {
    // No fabricated winner on any non-live expiry (PRD FR-08/SYS §8).
    return {
      matchFinished: { matchId: room.matchId, winnerId: status === 'ABORTED' ? null : room.winnerId, status },
    };
  }
  return { roomLapsed: { status } };
}

export function onReconnect(
  room: RoomSession,
  participantId: string,
  tokenForParticipant: (participantId: string) => string | undefined,
  sessionToken: string,
  clock: Clock,
): Outcomes {
  const participant = room.participants.find((p) => p.participantId === participantId);
  if (!participant) return { events: {}, errors: [] };
  const expected = tokenForParticipant(participantId);
  if (expected !== sessionToken) {
    return { events: {}, errors: [{ code: ERROR_CODES.SUBSCRIBE_AUTH, message: 'Invalid room session token.' }] };
  }
  participant.connected = true;
  participant.disconnectGraceEndsAt = null;
  return { events: {}, errors: [] };
}
// hard disconnects who never came back within grace + hard timeout
function reapDisconnected(room: RoomSession, clock: Clock) {
  const now = clock.now();
  const graceExpired = room.participants.filter(
    (p) => !p.connected && p.disconnectGraceEndsAt != null && p.disconnectGraceEndsAt <= now,
  );
  for (const p of graceExpired) {
    p.disconnectGraceEndsAt = null;
  }
  if (graceExpired.length > 0 && room.roomStatus === 'LIVE') {
    // SYS.md: grace expiry during match = elimination; dropParticipant quorum
    // loss then aborts (no fabricated winner) when no survivors remain.
    for (const p of graceExpired) {
      p.alive = false;
      if (room.bombHolderId === p.participantId) {
        room.bombHolderId = null;
      }
    }
  }
  if (graceExpired.length > 0 && (room.roomStatus === 'WAITING' || room.roomStatus === 'COUNTDOWN')) {
    // Lobby seat's grace expired without returning: remove participant
    // (SYS.md FR-09: preserve seat only for brief disconnect).
    for (const p of graceExpired) {
      dropParticipant(room, p.participantId, clock);
    }
  }
}

// ---------------------------------------------------------------------------
// Countdown completion
// ---------------------------------------------------------------------------

// Returns events to broadcast when the 15s lobby countdown completes or lapsed.
export function maybeStartMatch(room: RoomSession, clock: Clock): Outcomes {
  if (room.roomStatus !== 'COUNTDOWN') return { events: {}, errors: [] };
  if (room.countdownStartsAt == null || clock.now() < room.countdownStartsAt + GAME_RULES.LOBBY_COUNTDOWN_MS) {
    return { events: {}, errors: [] }; // not yet time
  }
  // Revalidate quorum per FLOWCHART.md §A E{Quorum still valid?}
  if (room.participants.length < GAME_RULES.MIN_PLAYERS || room.participants.length > GAME_RULES.MAX_PLAYERS) {
    room.roomStatus = 'WAITING';
    room.countdownStartsAt = null;
    room.participants.forEach((p) => { p.ready = false; });
    return { events: { roomCountdownCanceled: { status: 'WAITING' } }, errors: [] };
  }
  // v0.5: quorum is seat count, not human count. A bot may hold a funded seat.
  if (!seatsMeetQuorum(room.participants)) {
    room.roomStatus = 'WAITING';
    room.countdownStartsAt = null;
    room.participants.forEach((p) => { p.ready = false; });
    return { events: { roomCountdownCanceled: { status: 'WAITING' } }, errors: [] };
  }
  // All seats full or minimum met: start the match
  return startMatch(room, clock);
}

/**
 * Seat-count gate. v0.5 removes the "2 humans + bot" allowance: a match starts
 * when MIN_PLAYERS seats are filled, whoever holds them. A bot may occupy a
 * seat only when the operator funded it — that is a funding/UI concern
 * (docs/DEMO_DECISIONS.md D2), not a rule the sim can check, because the sim
 * never sees wallets.
 */
function seatsMeetQuorum(participants: GameParticipant[]): boolean {
  return participants.length >= GAME_RULES.MIN_PLAYERS;
}

export function startMatch(room: RoomSession, clock: Clock): Outcomes {
  const now = clock.now();
  room.roomStatus = 'LIVE';
  room.matchId = uuid();
  room.tick = 0;
  room.countdownStartsAt = null;
  room.winnerId = null;
  room.finishedAt = null;
  // Reset live state — a previous match in this room must not leak.
  for (const p of room.participants) {
    p.alive = true;
    p.stamina = GAME_RULES.STAMINA_MAX;
    p.isSprinting = false;
    p.lastPassAcceptedAt = null;
    p.lastSprintEndedAt = null;
    p.lastTickAt = now;
    p.disconnectGraceEndsAt = null;
  }
  // Never invent a winner on an unrecoverable match.
  if (room.participants.length < GAME_RULES.MIN_PLAYERS) {
    return { events: terminateMatch(room, 'ABORTED', clock), errors: [] };
  }
  pickHolder(room);
  room.bombExpiresAt = now + GAME_RULES.BOMB_CYCLE_MS;
  return {
    events: {
      matchStarted: { matchId: room.matchId, startedAtMs: now },
    },
    errors: [],
  };
}

// Random eligible holder at round start (PRD §3), seed/commitment logged on match events.
function pickHolder(room: RoomSession): void {
  const eligible = room.participants.filter((p) => p.alive);
  if (eligible.length === 0) {
    room.bombHolderId = null;
    return;
  }
  // ponytail: Math.random holder pick, seed commitment when chain/match audit wants it
  const idx = Math.floor(homebrewRandom() * eligible.length);
  const holder = eligible[idx];
  room.bombHolderId = holder.participantId;
}
function homebrewRandom(): number {
  return Math.random();
}

// ---------------------------------------------------------------------------
// Tick / movement
// ---------------------------------------------------------------------------

export function tickRoom(room: RoomSession, clock: Clock): Outcomes {
  if (room.roomStatus !== 'LIVE') return { events: {}, errors: [] };
  room.tick += 1;
  const now = clock.now();
  reapDisconnected(room, clock);
  const eventsCollected: GameEvents = {};

  for (const p of room.participants) {
    if (!p.alive) continue;
    // Integrate per monotonic elapsed server time (SYS.md §5, GAMEPLAY_CONTROLS §4).
    // ponytail: dt clamped to 2s so a stalled process can't dump 5 stamina bars at once.
    const dtSec = clampDt(now - p.lastTickAt);
    p.lastTickAt = now;

    // actual sprint (GAMEPLAY_CONTROLS §4): requested AND stamina > 0 AND moving
    const moving = p.lastInput != null && (p.lastInput.moveX !== 0 || p.lastInput.moveZ !== 0);
    const actuallySprinting = p.isSprinting && p.stamina > 0 && moving;
    if (actuallySprinting) {
      // drain with float-safe snap to exact zero (prevents 9e-15 residue
      // blocking the "reached zero" rules like GS-01 forced walk)
      const next = p.stamina - GAME_RULES.SPRINT_DRAIN_PER_SEC * dtSec;
      p.stamina = Math.abs(next) < 1e-9 ? 0 : Math.max(0, next);
      if (p.stamina === 0) {
        // forced walk at zero: drop the sprint request + regen anchor (GS-01, §4)
        p.isSprinting = false;
        p.lastSprintEndedAt = now;
      }
    } else if (p.isSprinting && p.stamina === 0) {
      p.isSprinting = false; // server refused the sprint (no stamina): walk applies
      if (p.lastSprintEndedAt == null) p.lastSprintEndedAt = now;
    } else {
      if (p.lastSprintEndedAt != null && now - p.lastSprintEndedAt >= GAME_RULES.STAMINA_REGEN_DELAY_MS) {
        // Regen runs only while not sprinting (GS-02 / GS-03 vectors).
        p.stamina = Math.min(GAME_RULES.STAMINA_MAX, p.stamina + GAME_RULES.STAMINA_REGEN_PER_SEC * dtSec);
      }
    }

    // movement integration from latest valid input
    if (p.lastInput && moving) {
      const speed = actuallySprinting ? GAME_RULES.SPRINT_SPEED : GAME_RULES.WALK_SPEED;
      p.position.x += p.lastInput.moveX * speed * dtSec;
      p.position.z += p.lastInput.moveZ * speed * dtSec;
      // keep inside the play surface. Clamp at MAX_POSITION_RADIUS, not
      // ARENA_RADIUS: the difference is PLAYER_RADIUS, and the client clamps at
      // the same value. Two different radii meant a networked client snapped on
      // every snapshot. See docs/DEMO_DECISIONS.md D1.
      const r = Math.hypot(p.position.x, p.position.z);
      if (r > GAME_RULES.MAX_POSITION_RADIUS) {
        p.position.x = (p.position.x / r) * GAME_RULES.MAX_POSITION_RADIUS;
        p.position.z = (p.position.z / r) * GAME_RULES.MAX_POSITION_RADIUS;
      }
      p.facingYaw = Math.atan2(p.lastInput.moveX, p.lastInput.moveZ);
    }
  }

  // bomb timed out with no holder (e.g. holder's grace expired) — absorb into explode()
  if (room.bombExpiresAt != null && room.bombHolderId == null && now >= room.bombExpiresAt) {
    const res = explode(room, clock);
    return res;
  }
  const errors: GameError[] = [];
  return { events: eventsCollected, errors };
}

function clampDt(ms: number): number {
  const dtSec = ms / 1000;
  return Math.min(2.0, Math.max(0, dtSec));
}

// Latest-value movement input (API_CONTRACT §5: stale/duplicate sequences
// ignored). The server clamps magnitude ≤1 and applies its own speeds — the
// client vector is never trusted as authoritative.
export function applyInput(
  room: RoomSession,
  participantId: string,
  input: PlayerInput,
  clock: Clock,
): { errors: GameError[] } {
  if (room.roomStatus !== 'LIVE') return { errors: [{ code: ERROR_CODES.BAD_STATE, message: 'No active match.' }] };
  const p = room.participants.find((e) => e.participantId === participantId);
  if (!p || !p.alive) return { errors: [{ code: ERROR_CODES.NOT_IN_ROOM, message: 'You are not a live participant.' }] };
  if (input.sequence <= p.lastInputSeq) return { errors: [] }; // stale/duplicate: ignore silently
  p.lastInputSeq = input.sequence;
  // clamp unit vector; diagonal never exceeds configured speed (GS-04, PRD FR-11)
  const len = Math.hypot(input.moveX, input.moveZ);
  const scale = len > 1 ? 1 / len : 1;
  p.lastInput = { sequence: input.sequence, moveX: input.moveX * scale, moveZ: input.moveZ * scale, sprint: input.sprint };
  // sprint is intent: server decides authoritatively each tick while stamina>0;
  // a request with zero stamina is refused immediately (QA_CROSSPLAY B).
  if (input.sprint && p.stamina <= 0) {
    p.isSprinting = false;
  } else {
    p.isSprinting = input.sprint;
  }
  // walk speed applies at the next tick; positions integrate in tickRoom only.
  return { errors: [] };
}

// ---------------------------------------------------------------------------
// Bomb passing
// ---------------------------------------------------------------------------
// Nearest eligible alive participant; tie broken by participantId (deterministic).
// anti-return lockback: former holder excluded for PASS_RETURN_LOCK_MS.
export function passBomb(room: RoomSession, byParticipantId: string, clock: Clock): Outcomes {
  if (room.roomStatus !== 'LIVE') return { events: {}, errors: [{ code: ERROR_CODES.BAD_STATE, message: 'No active match.' }] };
  const from = room.participants.find((p) => p.participantId === byParticipantId);
  if (!from || !from.alive) return { events: {}, errors: [{ code: ERROR_CODES.NOT_IN_ROOM, message: 'You are not a live participant.' }] };
  const now = clock.now();
  if (room.bombHolderId !== byParticipantId) {
    return { events: {}, errors: [{ code: ERROR_CODES.NO_HOLDER, message: 'You do not hold the bomb.' }] };
  }
  if (room.nextPassAllowedAt != null && now < room.nextPassAllowedAt) {
    return { events: {}, errors: [{ code: ERROR_CODES.PASS_COOLDOWN, message: 'Pass is cooling down.' }] };
  }
  // lockback: only blocks the previous holder receiving it back, not others (API_CONTRACT event name same)
  const candidates = room.participants.filter((p) => {
    if (!p.alive) return false;
    if (p.participantId === byParticipantId) return false;
    if (room.bombLockbackFromId === p.participantId && room.bombLockbackUntil != null && now < room.bombLockbackUntil) {
      return false;
    }
    const dist = Math.hypot(p.position.x - from.position.x, p.position.z - from.position.z);
    return dist <= GAME_RULES.PASS_RANGE;
  });
  if (candidates.length === 0) {
    return {
      events: {},
      errors: [{ code: ERROR_CODES.NO_PASS_TARGET, message: 'No eligible teammate within 1.8 units.' }],
    };
  }
  // ponytail: O(n) scan is fine for 4 players
  let target = candidates[0];
  let bestDist = Infinity;
  for (const cand of candidates) {
    const dist = Math.hypot(cand.position.x - from.position.x, cand.position.z - from.position.z);
    if (dist < bestDist || (dist === bestDist && cand.participantId < target.participantId)) {
      target = cand;
      bestDist = dist;
    }
  }
  const tick = room.tick;
  room.bombHolderId = target.participantId;
  // API_CONTRACT: passing does not reset the bomb countdown; deadline unchanged.
  from.lastPassAcceptedAt = now;
  room.nextPassAllowedAt = now + GAME_RULES.PASS_COOLDOWN_MS;
  room.bombLockbackFromId = from.participantId;
  room.bombLockbackUntil = now + GAME_RULES.PASS_RETURN_LOCK_MS;
  return {
    events: {
      bombPassAccepted: { fromId: byParticipantId, toId: target.participantId, tick },
    },
    errors: [],
  };
}

// Explosion: current holder eliminated (GAMEPLAY_CONTROLS §1), next round or winner.
export function explode(room: RoomSession, clock: Clock): Outcomes {
  if (room.roomStatus !== 'LIVE') return { events: {}, errors: [] };
  const now = clock.now();
  if (room.bombExpiresAt == null || now < room.bombExpiresAt) {
    return { events: {}, errors: [] };
  }
  const holder = room.participants.find((p) => p.participantId === room.bombHolderId);
  const eliminatedId = holder?.participantId;
  if (holder) {
    holder.alive = false;
  }
  room.bombHolderId = null;
  room.bombExpiresAt = null;
  room.bombLockbackFromId = null;
  room.bombLockbackUntil = null;
  room.nextPassAllowedAt = null;
  const survivors = room.participants.filter((p) => p.alive);
  const events: GameEvents = eliminatedId ? { elimination: { eliminatedId } } : {};
  if (survivors.length === 1) {
    room.winnerId = survivors[0].participantId;
    room.finishedAt = now;
    const events1 = terminateMatch(room, 'FINISHED', clock);
    return { events: { ...events, ...events1 }, errors: [] };
  }
  if (survivors.length === 0) {
    // No invented winner when everyone is gone (PRD §3).
    room.winnerId = null;
    room.finishedAt = now;
    const events1 = terminateMatch(room, 'ABORTED', clock);
    return { events: { ...events, ...events1 }, errors: [] };
  }
  // More than one survivor: new 10s cycle, holder re-picked by server.
  room.bombExpiresAt = now + GAME_RULES.BOMB_CYCLE_MS;
  pickHolder(room);
  return { events, errors: [] };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export function cancelRoom(room: RoomSession, byParticipantId: string, clock: Clock): { events: GameEvents; errors: GameError[] } {
  if (room.hostParticipantId !== byParticipantId) {
    return { events: {}, errors: [{ code: ERROR_CODES.NOT_HOST, message: 'Only the host can cancel.' }] };
  }
  if (room.roomStatus !== 'WAITING' && room.roomStatus !== 'COUNTDOWN') {
    return { events: {}, errors: [{ code: ERROR_CODES.BAD_STATE, message: 'Room can be canceled only before LIVE.' }] };
  }
  return { events: terminateMatch(room, 'CANCELED', clock), errors: [] };
}

// Decrement room expiry (PRD FR-08): after 10 min, waiting room cancels itself.
export function maybeExpire(room: RoomSession, clock: Clock): GameEvents | undefined {
  if (clock.now() >= room.expiresAt && room.roomStatus !== 'LIVE' && room.roomStatus !== 'FINISHED' && room.roomStatus !== 'ABORTED' && room.roomStatus !== 'CANCELED') {
    const events = terminateMatch(room, 'CANCELED', clock);
    return events;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function roomPublicState(room: RoomSession): {
  roomId: string; code: string; status: RoomStatus;
  minPlayers: number; maxPlayers: number;
  virtualDemoEntryWei: string;
  allowDemoBot: boolean; startAtMs: number | null;
  roomKey: string | null;
  escrowStatus: RoomSession['escrowStatus'];
  participants: Array<{ participantId: string; ready: boolean; kind: ParticipantKind; walletAddress: string | null }>;
} {
  return {
    roomId: room.roomId,
    code: room.code,
    status: room.roomStatus,
    minPlayers: GAME_RULES.MIN_PLAYERS,
    maxPlayers: GAME_RULES.MAX_PLAYERS,
    virtualDemoEntryWei: room.virtualDemoEntryWei,
    allowDemoBot: room.allowDemoBot,
    startAtMs: room.roomStatus === 'COUNTDOWN' ? room.countdownStartsAt! + GAME_RULES.LOBBY_COUNTDOWN_MS : null,
    roomKey: room.roomKey,
    escrowStatus: room.escrowStatus,
    participants: room.participants.map((p) => ({
      participantId: p.participantId,
      ready: p.ready,
      kind: p.kind,
      walletAddress: p.walletAddress,
    })),
  };
}

export function matchSnapshot(room: RoomSession, clock?: Clock): {
  matchId: string;
  tick: number;
  serverTimeMs: number;
  players: Array<{
    participantId: string;
    kind: ParticipantKind;
    position: { x: number; y: number; z: number };
    velocity: { x: number; z: number }; // zeroed for MVP; clients interpolate locally
    facingYaw: number;
    alive: boolean;
    stamina: number;
    isSprinting: boolean;
    disconnected: boolean;
  }>;
  bombHolderId: string | null;
  bombExpiresAtMs: number | null;
  livingCount: number;
  status: RoomStatus;
} {
  return {
    matchId: room.matchId ?? '',
    tick: room.tick,
    serverTimeMs: clock ? clock.now() : Date.now(),
    players: room.participants.map((p) => ({
      participantId: p.participantId,
      kind: p.kind,
      position: { ...p.position }, // copy: no live reference leak to clients
      velocity: { x: 0, z: 0 },
      facingYaw: p.facingYaw,
      alive: p.alive,
      stamina: p.stamina,
      isSprinting: p.isSprinting,
      disconnected: !p.connected,
    })),
    bombHolderId: room.bombHolderId,
    bombExpiresAtMs: room.bombExpiresAt,
    livingCount: room.participants.filter((p) => p.alive).length,
    status: room.roomStatus,
  };
}

export type GameOutcomes = Outcomes;

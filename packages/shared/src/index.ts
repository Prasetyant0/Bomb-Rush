import { z } from 'zod'; // pinned via imports map: zod -> zod@3.24.1


// ---------------------------------------------------------------------------
// Constants — canonical values from docs/spec/API_CONTRACT.md §1 (v0.5).
// Shared between the server (authoritative) and clients (UI).
//
// Deviations from the spec are recorded in docs/DEMO_DECISIONS.md, not here.
// ---------------------------------------------------------------------------

export const GAME_RULES = {
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 4,
  // DECISIONS.md D02 requires 3-4 HUMANS with no bot in P0. A bot MAY fill a
  // seat only when funded by the operator wallet and disclosed in the UI — see
  // docs/DEMO_DECISIONS.md D2. MIN_HUMANS is therefore not a rule constant:
  // the gate is MIN_PLAYERS funded seats, whoever holds them.
  WALK_SPEED: 4.5,
  SPRINT_SPEED: 7.0,
  STAMINA_MAX: 5.0,
  SPRINT_DRAIN_PER_SEC: 1.0,
  STAMINA_REGEN_DELAY_MS: 1500,
  STAMINA_REGEN_PER_SEC: 1.0,
  SPRINT_REENABLE_THRESHOLD: 0.5, // GAMEPLAY_CONTROLS §4 anti-flicker threshold
  BOMB_CYCLE_MS: 10_000,
  PASS_RANGE: 1.8,
  PASS_COOLDOWN_MS: 700,
  PASS_RETURN_LOCK_MS: 1000,
  LOBBY_COUNTDOWN_MS: 15_000,
  SERVER_TICK_HZ: 20,
  SNAPSHOT_HZ: 15,
  RECONNECT_GRACE_MS: 5000,
  ROOM_EXPIRY_MS: 600_000,

  // Arena — v0.5. Both client and server clamp at MAX_POSITION_RADIUS. They
  // used to clamp at different radii (server 10, client 9), which made a
  // networked client snap on every snapshot.
  ARENA_RADIUS: 7.0,
  PLAYER_RADIUS: 0.4,
  MAX_POSITION_RADIUS: 6.6, // ARENA_RADIUS - PLAYER_RADIUS
  PLAYER_COLLISION: false,
  SPAWN_RING_RADIUS: 4.2, // ARENA_RADIUS * 0.6

  MAX_INPUT_PER_SEC: 30,

  // Escrow — testnet only, no real value.
  CHAIN_ID: 10143,
  FUNDING_WINDOW_SEC: 600,
  RESOLUTION_WINDOW_SEC: 1200,
} as const;

/** Nominal gameplay per seat count. Excludes lobby, transitions and result. */
export const MATCH_DURATION_MS = {
  3: GAME_RULES.BOMB_CYCLE_MS * 2, // 20_000
  4: GAME_RULES.BOMB_CYCLE_MS * 3, // 30_000
} as const;

/** Entry bounds enforced by the deployed contract; read `entryBounds()` to confirm. */
export const ENTRY_MIN_WEI = 1_000_000_000_000_000n; // 0.001 test MON
export const ENTRY_MAX_WEI = 10_000_000_000_000_000n; // 0.01 test MON
export const ENTRY_DEFAULT_WEI = ENTRY_MIN_WEI;
export const ENTRY_PRESETS_MON = ['0.001', '0.005', '0.01'] as const;

export const PROTOCOL_VERSION = '0.5';
export const RULE_VERSION = 'bomb-rush-v0.5'; // ERD.md: stored on matches
export const CHAIN_ID = GAME_RULES.CHAIN_ID; // Monad Testnet — P0 only, no mainnet

// ---------------------------------------------------------------------------
// Room status — SYS.md state machine, trimmed to P0: FUNDING / REFUND_* /
// SETTLEMENT_* states are P2 (testnet escrow) and cannot occur in P0.
// ---------------------------------------------------------------------------
export const ROOM_STATUS_DEFAULT = 'WAITING';
export type RoomStatus =
  | 'WAITING'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'FINISHED'
  | 'CANCELED'
  | 'ABORTED';

export type ParticipantKind = 'HUMAN' | 'DEMO_BOT';

// ---------------------------------------------------------------------------
// Error codes — API_CONTRACT `game:error`, plus REST status mapping in server.
// ---------------------------------------------------------------------------
export const ERROR_CODES = {
  PROTOCOL_VERSION: 'PROTOCOL_VERSION_MISMATCH',
  SUBSCRIBE_AUTH: 'SUBSCRIBE_AUTH_FAILED',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_STARTED: 'ROOM_ALREADY_STARTED',
  ROOM_NOT_JOINABLE: 'ROOM_NOT_JOINABLE',
  NOT_HOST: 'NOT_HOST',
  BAD_STATE: 'BAD_STATE',
  BAD_PAYLOAD: 'BAD_PAYLOAD',
  RATE_LIMITED: 'RATE_LIMITED',
  ALREADY_READY: 'ALREADY_READY',
  NO_HOLDER: 'NOT_BOMB_HOLDER',
  NO_PASS_TARGET: 'NO_PASS_TARGET',
  PASS_COOLDOWN: 'PASS_COOLDOWN',
  PASS_LOCKBACK: 'PASS_LOCKBACK',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ---------------------------------------------------------------------------
// Zod schemas — every Socket.IO payload validated with these (TRD §5).
// Keys are event names; schema shape mirrors API_CONTRACT §3/§4.
// ---------------------------------------------------------------------------
export const socketSchemas = {
  'room:subscribe': z.object({ roomId: z.string().uuid(), sessionToken: z.string().min(1).max(128) }),
  'room:set_ready': z.object({ ready: z.boolean() }),
  'player:input': z
    .object({
      sequence: z.number().int().nonnegative(),
      moveX: z.number().finite().min(-1).max(1),
      moveZ: z.number().finite().min(-1).max(1),
      sprint: z.boolean(),
    })
    .strict(),
  'bomb:pass_intent': z.object({ sequence: z.number().int().nonnegative() }).strict(),
  'match:request_snapshot': z.object({ matchId: z.string().uuid() }),
} as const;

export type SocketEventNames = keyof typeof socketSchemas;

// Deterministic spawn positions (DECISIONS Q4: even distribution)
const SPAWN_RING_RADIUS = GAME_RULES.SPAWN_RING_RADIUS;
export const SPAWN_POINTS = [
  { x: SPAWN_RING_RADIUS, z: 0 },
  { x: -SPAWN_RING_RADIUS, z: 0 },
  { x: 0, z: SPAWN_RING_RADIUS },
  { x: 0, z: -SPAWN_RING_RADIUS },
] as const;

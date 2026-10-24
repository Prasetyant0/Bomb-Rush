# API_CONTRACT.md — Canonical REST and Socket.IO Contract

**Version:** `game-protocol/0.3`. This supersedes stale dash/target-specific event designs. This document should produce `packages/shared` TypeScript types and Zod schemas. Agree on it **before** agents implement frontend/backend separately.

## 1. Types and invariants

```ts
export type RoomStatus =
  | 'WAITING' | 'COUNTDOWN' | 'LIVE' | 'FINISHED' | 'CANCELED' | 'ABORTED';
export type DeviceInput = 'DESKTOP_KBM' | 'MOBILE_TOUCH' | 'UNKNOWN';
export type ParticipantKind = 'HUMAN' | 'DEMO_BOT';

export type PlayerInput = {
  sequence: number;  // strictly increasing within player session
  moveX: number;     // world-space X, finite [-1,1]
  moveZ: number;     // world-space Z, finite [-1,1]
  sprint: boolean;   // intent, server may refuse at 0 stamina
};
export type PassIntent = { sequence: number }; // server chooses nearest eligible target

export type PlayerSnapshot = {
  participantId: string;
  kind: ParticipantKind;
  position: {x: number; y: number; z: number};
  velocity: {x: number; z: number};
  facingYaw: number;
  alive: boolean;
  stamina: number; // [0,5], from server
  isSprinting: boolean;
  disconnected: boolean;
};
export type MatchSnapshot = {
  matchId: string;
  tick: number;
  serverTimeMs: number;
  players: PlayerSnapshot[];
  bombHolderId: string | null;
  bombExpiresAtMs: number;
  livingCount: number;
};
export type RoomPublicState = {
  roomId: string; code: string; status: RoomStatus;
  minPlayers: 3; maxPlayers: 4;
  virtualDemoEntryWei: string; // **virtual** amount, not deposited wei
  allowDemoBot: boolean; startAtMs: number | null;
  participants: Array<{participantId: string; ready: boolean; kind: ParticipantKind}>;
};
```

Use `virtualDemoEntryWei` string to allow standard 18-decimal parsing without JS float precision loss; it must be labeled virtual points and **must not** be accepted as actual transaction proof.

## 2. REST API (Fastify)
| Method | Route | Behavior |
|---|---|---|
| `GET` | `/health` | Simple readiness and server version |
| `GET` | `/api/rooms?status=WAITING` | Public room summaries only |
| `POST` | `/api/rooms` | `visibility`, `virtualDemoEntryWei`, `allowDemoBot`; returns code and room ID |
| `POST` | `/api/rooms/:roomId/join` | Authenticated or guest signed session proof; returns participant and short-lived socket token |
| `GET` | `/api/rooms/:roomId` | Read canonical room state (no privileged fields) |
| `POST` | `/api/rooms/:roomId/cancel` | Host-only before LIVE; no effect on settled games |
| `GET` | `/api/matches/:matchId/result` | Winner, virtual pool, chain record state/explorer URL |

`room:set_ready` is **Socket.IO**, not duplicated as a separate REST source of truth. Use a shared zod schema. No public REST route permits setting winner or passing arbitrary on-chain settled balance.

## 3. Socket.IO client → server
```ts
type ClientToServerEvents = {
  'room:subscribe': (payload: { roomId: string; sessionToken: string }) => void;
  'room:set_ready': (payload: { ready: boolean }) => void;
  'player:input': (payload: PlayerInput) => void;            // 20-30/sec max
  'bomb:pass_intent': (payload: PassIntent) => void;         // edge-trigger E/PASS
  'match:request_snapshot': (payload: {matchId: string}) => void;
};
```
- Client may transform movement by camera yaw locally. Server clamps `sqrt(moveX² + moveZ²) ≤ 1`, applies its own walking/sprint speed and stamina.
- Never send device mode as trusted rules permission, and never let client set `bombHolderId`, `winnerId`, stamina or server time.
- Scope socket room by authenticated joined session; a client cannot subscribe to another private room via ID alone.

## 4. Socket.IO server → client
```ts
type ServerToClientEvents = {
  'room:state': (data: RoomPublicState) => void;
  'room:countdown': (data: {startAtMs: number; serverTimeMs: number}) => void;
  'match:started': (data: {matchId: string; startedAtMs: number}) => void;
  'match:snapshot': (data: MatchSnapshot) => void;
  'bomb:pass_accepted': (data: {fromId: string; toId: string; tick: number}) => void;
  'match:event': (data: {type: 'EXPLODE'|'ELIMINATE'|'RECONNECT'; actorId?: string; tick: number}) => void;
  'match:finished': (data: {matchId: string; winnerId: string; resultHash: string}) => void;
  'chain:status': (data: {state:'PENDING'|'CONFIRMED'|'FAILED'; txHash?: string; explorerUrl?: string}) => void;
  'game:error': (data: {code: string; message: string}) => void;
};
```

## 5. Network rules
- `sequence` strictly increases; stale/duplicate input ignored. Reconnect requests new full snapshot plus serverTime; do not replay old PASS action automatically.
- Pass is *reliable intent* once per action; movement is latest-value input stream. Reject pass after bomb expiry.
- Server loop: ~20Hz authoritative world sim; snapshots 10–20 Hz; renderer interpolate to display FPS; movement never determined by local React animation.
- Define `eventVersion=0.3` at handshake and reject mismatched client version with actionable error.
- Countdown and bomb expire relative to absolute server deadline; UI estimates local countdown only and snaps back to authoritative server state.
- Restrict input rates, payload size, origins, room memberships and simultaneous sockets per session; zod validate every event.

## 6. Test example payload
```json
{
  "event": "player:input",
  "payload": {"sequence": 145, "moveX": 0.7071, "moveZ": 0.7071, "sprint": true}
}
```

## 7. Bot and chain boundaries
- Demo bot emits same normalized player intents; never calls `setWinner` or bypasses stamina/pass cooldown.
- Game server sends finalized result to an authorized chain recorder; chain writes only match summary. Test MON deposits and refunds are P2 and intentionally **absent** from P0 REST/socket behavior.
- Chain proof is a record of signed adjudication, not an independent cryptographic proof of fair gameplay.

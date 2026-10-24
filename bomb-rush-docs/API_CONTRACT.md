# API_CONTRACT — game-protocol/0.5 (CANONICAL)

**Authority:** all HTTP payloads, Socket.IO messages, shared constants, status definitions. Code must match this contract; update this document first. All money-like fields are **bigint wei encoded as decimal strings** in JSON; `number` and JS floating-point arithmetic are forbidden for token amounts. `walletAddress` is checksummed EVM address or normalized lowercase consistently; hashes are `0x` + 64 hex chars. Timestamps in HTTP/socket are `*_Ms` epoch milliseconds. Solidity deadlines are seconds.

## Constants (copy into `packages/shared/src/constants.ts`)
```ts
export const GAME_RULES = {
  MIN_PLAYERS: 3, MAX_PLAYERS: 4,
  ARENA_RADIUS: 7.0, PLAYER_RADIUS: 0.4, MAX_POSITION_RADIUS: 6.6,
  PLAYER_COLLISION: false,
  WALK_SPEED: 4.5, SPRINT_SPEED: 7.0, // crossplay provisional
  STAMINA_MAX: 5.0, SPRINT_DRAIN_PER_SEC: 1.0,
  STAMINA_REGEN_DELAY_MS: 1500, STAMINA_REGEN_PER_SEC: 1.0,
  SPRINT_REENABLE_THRESHOLD: 0.5,
  BOMB_CYCLE_MS: 10000, PASS_RANGE: 1.8,
  PASS_COOLDOWN_MS: 700, PASS_RETURN_LOCK_MS: 1000,
  LOBBY_COUNTDOWN_MS: 15000, ROOM_EXPIRY_MS: 600000,
  RECONNECT_GRACE_MS: 5000,
  SERVER_TICK_HZ: 20, SNAPSHOT_HZ: 15, MAX_INPUT_PER_SEC: 30,
  CHAIN_ID: 10143, FUNDING_WINDOW_SEC: 600,
  RESOLUTION_WINDOW_SEC: 1200,
  ENTRY_MIN_WEI: 1_000_000_000_000_000n, // 0.001 test MON
  ENTRY_MAX_WEI: 10_000_000_000_000_000n, // 0.01 test MON
  ENTRY_DEFAULT_WEI: 1_000_000_000_000_000n,
  ENTRY_PRESETS_MON: ['0.001', '0.005', '0.01'],
} as const;
export const MATCH_DURATION_MS = { 3: 20000, 4: 30000 } as const;
```
**Do not add or keep `entryCredits`, `ENTRY_CREDITS_*`, `guestHash`, `recordMatch`, or `virtualDemoEntryWei` in the P0 funded path.** Retired v0.4 names are forbidden in active types.

## Canonical TypeScript types
```ts
export type GameStatus = 'WAITING' | 'COUNTDOWN' | 'LIVE' | 'FINISHED' | 'CANCELED';
export type EscrowStatus = 'NONE' | 'FUNDING' | 'FUNDED' | 'SETTLED' | 'CANCELED';
export type TransferStatus = 'NOT_STARTED' | 'AWAITING_WALLET' | 'SUBMITTED' |
  'CONFIRMED' | 'FAILED';
export type SettlementView = 'NONE' | 'PENDING' | 'CLAIMABLE' | 'PAID' | 'FAILED' |
  'REFUNDABLE' | 'REFUND_PENDING' | 'REFUNDED';
export type RoomVisibility = 'PUBLIC' | 'PRIVATE';
export type CancelReason = 'HOST_CANCELED' | 'ROOM_EXPIRED' | 'QUORUM_LOST' |
  'UNRECOVERABLE' | 'OPERATOR_ABORT' | 'FUNDING_TIMEOUT' | 'RESOLUTION_TIMEOUT';
export type PlayerInput = { sequence: number; moveX: number; moveZ: number; sprint: boolean; };
export type PassIntent = { sequence: number; }; // No target: server resolves nearest.
export type RoomParticipant = {
  participantId: string; displayName: string; walletAddress: `0x${string}`;
  funded: boolean; ready: boolean; connected: boolean; isHost: boolean;
  depositedTxHash: `0x${string}` | null;
};
export type RoomPublicState = {
  roomId: string; roomKey: `0x${string}`; code: string;
  chainId: 10143; escrowAddress: `0x${string}`;
  gameStatus: GameStatus; escrowStatus: EscrowStatus;
  visibility: RoomVisibility; maxPlayers: 3 | 4; minPlayers: 3;
  entryWei: string; potWei: string; depositCount: number;
  fundingDeadlineMs: number; resolutionDeadlineMs: number;
  participants: RoomParticipant[]; startAtMs: number | null;
  matchId: string | null; matchStartedAtMs: number | null;
  cancelReason: CancelReason | null;
};
export type MatchResult = {
  roomId: string; roomKey: `0x${string}`; matchId: string;
  winnerId: string; winnerName: string; winnerAddress: `0x${string}`;
  resultHash: `0x${string}`; poolWei: string;
  settlement: SettlementView;
  settleTxHash: `0x${string}` | null;
  payoutTxHash: `0x${string}` | null;
};
export type PlayerSnapshot = {
  participantId: string; displayName: string;
  position: {x:number;y:number;z:number}; facingYaw: number;
  alive:boolean; stamina:number; isSprinting:boolean; disconnected:boolean;
};
export type MatchSnapshot = {
  matchId:string; tick:number; serverTimeMs:number;
  players:PlayerSnapshot[]; bombHolderId:string|null;
  bombExpiresAtMs:number; livingCount:number;
};
export type ApiError = {
  code: string; message: string; retryable: boolean;
  details?: Record<string,string>;
};
```

## HTTP REST endpoints (same-origin server)
| Method | Path | Request | Response | Auth/guard |
|---|---|---|---|---|
| `POST` | `/api/rooms/prepare` | `{displayName,maxPlayers,entryWei,visibility,walletAddress}` | `{roomId,roomKey,code,chainId,contractAddress,createRoomArgs}` | Validate wallet, seat range, amount, expiring prepare token; **NO funded room yet** |
| `POST` | `/api/rooms/:code/create-confirm` | `{txHash,walletAddress}` | `{room:RoomPublicState}` | Server verifies receipt + RoomCreated/DepositConfirmed on chain, contract and exact host |
| `GET` | `/api/rooms/:code` | — | `{room:RoomPublicState}` | Public summary; private discoverability differs, code is bearer invite |
| `POST` | `/api/rooms/:code/join-intent` | `{displayName,walletAddress}` | `{roomKey,entryWei,chainId,contractAddress}` | Seat reservation is *provisional*, limited until deposit receipt |
| `POST` | `/api/rooms/:code/deposit-confirm` | `{txHash,walletAddress}` | `{room:RoomPublicState}` | Chain receipt, event, unique wallet, amount verification; idempotent |
| `POST` | `/api/rooms/:code/ready` | `{ready:boolean}` | `{room:RoomPublicState}` | Authenticated session + matching funded wallet; NEVER trusts arbitrary playerId |
| `POST` | `/api/rooms/:code/leave` | `{}` | `{room:RoomPublicState}` | Leaving doesn't un-deposit; exit shows refund implications |
| `GET` | `/api/matches/:matchId/result` | — | `{result:MatchResult}` | Winner can exist while payout pending |
| `GET` | `/api/escrow/:roomKey` | — | `{escrowStatus,potWei,depositCount,winnerAddress,prizePaid,deadlineMs}` | Read-only contract derived; safe on server restart |
| `GET` | `/health` | — | `{status:'ok'}` | No sensitive diagnostics |

**Never** expose REST endpoints allowing a client to submit `winner`, `playerPosition`, `stamina`, `potWei`, `funded=true`, `settle`, or `refundPaid`. `txHash` is a reference to independently verified chain data, not authorization by itself. Wallet/session ownership must be bound with one-time signed challenge (domain, nonce, expiry, chain ID), or equivalent authenticated wallet proof; a plain `walletAddress` request body is not authentication.

### Room prepare and ID rule
- `roomKey = keccak256(abi.encodePacked('BOMB_RUSH_V05', chainId, serverNonce, hostAddress))`, generated server-side from secure randomness; expose 6-char code separately.
- Prep expires quickly; collision or a second create on same key is rejected. Active contract ID is authoritative after successful `RoomCreated` receipt.
- Do not assign readiness or reserve a funded seat solely from a tx hash without a verified event; publish `FUNDED` only after reading chain state.

## Socket.IO namespace `/game`, schema-defined events
| Direction | Event | Payload | Rules |
|---|---|---|---|
| C→S | `room:subscribe` | `{code,sessionToken}` | Session must be authorized; no duplicate seat |
| S→C | `room:state` | `RoomPublicState` | Authoritative snapshot |
| S→C | `room:funding_updated` | `{roomKey,escrowStatus,depositCount,potWei}` | Emitted on verified chain transition |
| S→C | `room:countdown` | `{startAtMs,serverTimeMs}` | 15 sec, admission lock |
| S→C | `match:started` | `{matchId,serverTimeMs,initialHolderId}` | Server generated RNG; announce holder |
| C→S | `player:input` | `PlayerInput` | 30/sec max; normalize; reject disconnected/unfunded |
| C→S | `bomb:pass_intent` | `PassIntent` | No client target; respect range/cooldowns |
| S→C | `bomb:pass_accepted` | `{fromId,toId,serverTimeMs}` | Client animates only on ack |
| S→C | `bomb:pass_rejected` | `{reason}` | No client authority |
| S→C | `match:snapshot` | `MatchSnapshot` | 15 Hz snapshot, 20 Hz sim |
| S→C | `match:eliminated` | `{participantId,cycle}` | Spectate only; no play inputs |
| S→C | `match:finished` | `MatchResult` | One result emitted |
| S→C | `escrow:settlement` | `{roomKey,settlement,settleTxHash?,payoutTxHash?}` | Based on checked chain state |
| S→C | `room:error` | `ApiError` | Actionable next step |

## Game/funding invariants
- `WAITING→COUNTDOWN` requires escrow `FUNDED`, depositCount == maxPlayers, exactly maxPlayers distinct authenticated wallets seated and all ready. At the countdown boundary re-read escrow state and quorum.
- A room with 3 slots may start only with 3 funded users. A room with 4 slots starts only with 4; **no underfunded 4-player game**.
- Funding and game states do not have identical state machines: a `FINISHED` game can have `FUNDED` chain state while settlement is pending; can later be `SETTLED` claimable or canceled/refundable on expiry if settlement never lands.
- Refund claim and prize claim are wallet/chain actions, not Socket.IO authority. Server broadcasts contract changes after receipts/log sync.

## Error codes (stable identifiers)
`INVALID_ENTRY_WEI`, `WRONG_CHAIN`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_EXPIRED`, `WALLET_REQUIRED`, `WALLET_PROOF_INVALID`, `NOT_FUNDED`, `ALREADY_FUNDED`, `TX_REVERTED`, `TX_UNCONFIRMED`, `TX_EVENT_MISMATCH`, `LOBBY_LOCKED`, `PASS_OUT_OF_RANGE`, `PASS_COOLDOWN`, `PASS_RETURN_LOCK`, `BOMB_EXPIRED`, `NOT_AUTHORIZED`, `MATCH_CANCELED`, `SETTLEMENT_PENDING`, `REFUND_NOT_AVAILABLE`, `RPC_UNAVAILABLE`, `RESULT_UNVERIFIED`.

## Versioning gate
Exactly one `game-protocol/0.5` across web, server, shared package and docs. Updating event fields requires bumping protocol revision and coordinated all-owner merge; v0.4 clients cannot connect to v0.5-funded backend silently.

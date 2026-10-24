# TRD — Technical Requirements Document

## 1. Stack and technical choice
| Tier | Choice | Reason |
|---|---|---|
| UI | React + TypeScript + Vite + Tailwind | Fast iteration |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei` | Direct GLB models, lighting, camera, animations |
| 3D visual editor | Triplex (optional) | Adjust React/R3F scene visually |
| Client state | Zustand | Local UI state; network authoritative source of truth |
| Backend | **Node.js + TypeScript + Fastify + Socket.IO** | REST rooms plus authoritative 20 Hz simulation |
| Database | **PostgreSQL + Drizzle ORM** | Metadata, audit, results (live room state in memory for single instance) |
| Web3 | wagmi + viem; Solidity + Foundry | Wallet and testnet contract |
| Deployment | Static site + socket-capable Node host | Browser-based live demo |

## 2. Required packages (suggested; check current compatibility)
`react react-dom three @react-three/fiber @react-three/drei zustand socket.io-client wagmi viem @tanstack/react-query`  
Server: `fastify socket.io zod`; DB: `postgres drizzle-orm drizzle-kit`; contract: `forge` (Foundry). Pin tested versions and check compatibility before use.

## 3. Proposed repository structure
```text
bomb-rush/
  apps/
    web/
      src/pages/{Home,Rooms,CreateRoom,Lobby,Arena,Results}.tsx
      src/game/{ArenaScene,PlayerModel,Bomb,HUD,ThirdPersonCamera}.tsx
      src/input/{keyboard,joystick,mobileButtons,inputMapper}.ts
      src/net/socket.ts
      src/web3/{wagmi,contracts}.ts
      public/models/
    server/
      src/{api,rooms,simulation,bots,settlement,auth,audit}/
  contracts/
    src/MatchRegistry.sol
    test/MatchRegistry.t.sol
  packages/shared/src/{events,schemas,types,constants}.ts
  docs/
```

## 4. REST API contract (illustrative)
| Verb | Endpoint | Request | Response |
|---|---|---|---|
| GET | `/api/rooms?status=WAITING` | — | `rooms[]` |
| POST | `/api/rooms` | `{visibility, demoEntryWei, allowDemoBot}` | `{roomId, code, status}` |
| GET | `/api/rooms/:roomId` | — | current room state |
| POST | `/api/rooms/:roomId/join` | `{sessionProof}` | `{participantId, room}` |
| — | Readiness is via Socket.IO `room:set_ready` | `{ready}` | authoritative `room:state` broadcast |
| POST | `/api/rooms/:roomId/cancel` | creator signed session | cancellation status |
| GET | `/api/matches/:matchId/result` | — | result, chain record state |

Protocol details are authoritative in `API_CONTRACT.md`; this table is an overview.

Security: bind wallet authentication to unique per-origin nonce and signed-in session; never trust `wallet_address` alone in POST body. Use SIWE-style signed session if wallet login is required.

## 5. Socket.IO protocol
**Client → server:**
- `room:subscribe` `{roomId, sessionToken}`
- `player:input` `{sequence, moveX, moveZ, sprint}` (world vector, magnitude ≤ 1)
- `bomb:pass_intent` `{sequence}` (server selects nearest eligible within 1.8 units)
- No `dash_intent` in v0.3; stamina sprint via continuous `player:input`
- `room:set_ready` `{ready}`

**Server → client:**
- `room:state` `{status, seats, amountWei, allowDemoBot, startAt}`
- `match:started` `{matchId, startAt, seedCommitment}`
- `match:snapshot` `{tick, serverTimeMs, participants[{position, stamina, isSprinting, alive}], bombHolderId, bombExpiresAt, livingCount}`
- `match:event` `{type, actorId, targetId?, tick}`
- `match:finished` `{winnerId, resultHash}`
- `chain:status` `{type, state, txHash?, explorerUrl?}`
- `error` `{code, message}`

Implement Zod validation and per-session rate limiting. Every game intent must be checked against server-side tick/session state. All messages have room scope.

## 6. Match registry contract minimal interface (testnet)
Minimal contract stores confirmed match outcomes, not detailed gameplay. Proposed API concepts:
- `recordMatch(bytes32 matchId, address winner, bytes32 resultHash, bytes signature)` — server-authorized, replay-protected match record.
- `getMatch(bytes32 matchId)` — query winner and hash.
- `MatchRecorded(matchId, winner, resultHash)` event.

**P1 optional demo escrow** is a separate clearly testnet-only contract that accepts exact demo deposits and implements cancel/refund/one-time settlement with full security tests. **Do not deploy any value-pooling contract to mainnet.** Avoid storing privileged contract keys in frontend; require secure server/environment secrets.

## 7. Transaction handling
- Submit record only after server finalizes result; sign chain-bound hash including chain ID, contract, match ID, result hash, winner, expiry/nonce.
- Query tx receipt and index only after confirmed; UI `pending`, `confirmed`, `failed` states.
- Worker idempotency key `(chainId, matchId, eventType)`.
- If record fails, gameplay winner remains valid off-chain while UI explicitly says *not yet recorded on-chain*.
- `chainId=10143` hard gate; reject unexpected chain or wrong contract.

## 8. Game timing and fairness test vectors
- Two pass requests in same tick: only first accepted under deterministic ordering.
- Pass to eliminated/unreachable player: reject.
- Pass within post-transfer return lockout: reject.
- Bomb holder disconnects: same timer continues; grace then elimination.
- 4th player tries joining filled room: reject.
- 1 human + 1 bot attempts to start: reject.
- 2 humans + 1 bot with one bot demo deposit pending: reject countdown until funded/ready.
- Two settlement requests: one accepted, duplicate no-op/reverted with known error.
- Room canceled before match: all test deposits reclaimable, none forfeited.

## 9. Quality/security gates
- E2E: 3 clients join, ready, begin, pass, explode, last survivor, result record success.
- Failover: delayed confirmations, two tabs same wallet, wallet switch, reconnect, invalid room code, mobile background/wallet handoff and return.
- Frontend fallback: reduced effects and model LOD on slow GPU; mobile DPR 1–1.5, desktop 1–2; avoid per-frame React state writes.
- Abuse: input throttling, origin allowlist, session nonce expiry, admin audit logs, no hardcoded private keys.
- Chain: contract tests for unauthorized record, duplicate ID, wrong signature, wrong chain, aborted game, cancel/refund if P1.
- Product: all demo amounts/testnet labels and house-bot disclosures persist across all surfaces.

## 10. Environment variables (names only)
```dotenv
VITE_API_URL=
VITE_SOCKET_URL=
VITE_CHAIN_ID=10143
VITE_MATCH_REGISTRY_ADDRESS=
DATABASE_URL=
SERVER_SIGNER_PRIVATE_KEY=
ROOM_EXPIRY_SECONDS=600
COUNTDOWN_SECONDS=15
ALLOW_DEMO_BOT=true
ENABLE_REAL_VALUE_STAKES=false
```
Never commit populated secrets. Enforce real-value stakes disabled in server code as well as environment settings.


## 11. Third-person + mobile implementation notes
- **Camera:** Drei `CameraControls` or a custom orbit-follow rig; player-relative target, yaw rotation from mouse drag/touch swipe, pitch clamp, zoom limit and damping. Camera is local only.
- **Desktop:** keyboard WASD, Shift hold and E edge-trigger. Do not use Space dash in v0.3.
- **Mobile:** separate UI overlays above WebGL canvas: floating joystick left, camera gesture zone right (excluding buttons), RUN toggle and PASS button. Use `pointerId` capture and a multi-pointer registry; do not treat only one touch as active.
- **Input:** keyboard/touch mapped to same world-space `moveX,moveZ,sprint` schema. Send ≤20–30 inputs/sec; server independently validates time, speed, collision and stamina.
- **Camera FPS:** smooth in render frame with `delta`, independent from authoritative simulation ticks; apply client interpolation for remote players.
- **Orientation:** provide portrait-safe menus and a landscape prompt for match; don't rely on `screen.orientation.lock()`.
- **Device graphics:** mobile low preset disables expensive bloom/shadows, caps DPR, batches geometry/materials, lazy-load GLB; first session should prewarm shaders before countdown when possible.
- **Web wallet:** if mobile wallet deep-links out and back, disconnect input immediately, then request a fresh socket snapshot on return; don't pause server countdown.

## 12. Source layout additions
```text
apps/web/src/game/{ThirdPersonCamera,StaminaHUD,PassTargetMarker,TouchControlLayer}.tsx
apps/web/src/input/{keyboard,joystick,mobileButtons,inputMapper}.ts
apps/server/src/simulation/{movement,stamina,bombPass,clock}.ts
packages/shared/src/{constants,events,schemas,types}.ts
```

## 13. Shared constants (initial balancing hypothesis)
```ts
export const GAME_RULES = {
  MIN_PLAYERS: 3, MAX_PLAYERS: 4,
  WALK_SPEED: 4.5, SPRINT_SPEED: 7.0,
  STAMINA_MAX: 5.0, SPRINT_DRAIN_PER_SEC: 1.0,
  STAMINA_REGEN_DELAY_MS: 1500, STAMINA_REGEN_PER_SEC: 1.0,
  BOMB_CYCLE_MS: 10_000, PASS_RANGE: 1.8,
  PASS_COOLDOWN_MS: 700, PASS_RETURN_LOCK_MS: 1000,
  LOBBY_COUNTDOWN_MS: 15_000, SERVER_TICK_HZ: 20,
  RECONNECT_GRACE_MS: 3000,
} as const;
```
The backend uses authoritative values from shared constants; mobile/desktop use the same constants for UI only. These numbers require playtesting on real devices.

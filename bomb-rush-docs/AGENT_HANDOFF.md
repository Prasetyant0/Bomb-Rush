# AGENT_HANDOFF.md — Three Developers + AI Coding Agents

**Goal:** six-hour hackathon execution with parallel, non-conflicting work and a completed laptop+Android+iPhone crossplay demo.

## 1. Ownership
| Owner | Primary responsibility | Folder ownership | Mandatory P0 deliverables |
|---|---|---|---|
| Dev A — Game/UX | React/R3F 3D scene, third-person follow camera, desktop controls, mobile joystick/buttons, responsive layout, GLB art | `apps/web/src/game`, `apps/web/src/input`, `apps/web/src/ui` | Camera orbit, playable mobile touch, 5-bar stamina HUD, PASS marker |
| Dev B — Backend/Realtime | Fastify server, Socket.IO room/game lifecycle, movement/stamina, proximity pass, network authority, reconnect, bot stub | `apps/server/src`, game simulation test suite | 3–4 seat authoritative match, no speed exploit, correct elimination |
| Dev C — Web3/Product/Integration | Landing/Create/Join/Lobby/Results flows, wallet and Monad registry, database, deployment, integration QA | `apps/web/src/pages`, `apps/web/src/web3`, `contracts`, `infra` | Live website, room URL/QR, signed result testnet receipt, deployment |

One developer (ideally Dev B as network contract owner) controls **`packages/shared`**. All three review event/type changes before merge.

## 2. Monorepo
```text
bomb-rush/
  apps/web/
    src/pages/     # Dev C
    src/game/      # Dev A
    src/input/     # Dev A
    src/ui/        # shared via agreed components
    src/net/       # Dev C consumes shared socket client
    src/web3/      # Dev C
  apps/server/src/{api,rooms,simulation,bots,chain}/  # Dev B except chain integration Dev C
  packages/shared/src/{constants,events,schemas,types}.ts  # owner Dev B
  contracts/src/MatchRegistry.sol                      # Dev C
  docs/                                               # source specs
```

## 3. Minimum merge rules
1. **First commit:** pnpm workspace and shared constants/types from `API_CONTRACT.md` + `GAMEPLAY_CONTROLS.md`, pinned versions and linter/build.
2. Establish handshake and real socket room event names. Never invent per-feature client events in parallel.
3. Backend emits fake snapshots early so Dev A can animate with canonical payload even before real sim is ready.
4. UI uses an adapter layer; rendering never mutates game authority. Dev C must not duplicate Ready/countdown logic in REST and Socket.IO.
5. All AI agents must read README, DECISIONS, GAMEPLAY_CONTROLS and API_CONTRACT **before implementation**. Agents must not overwrite files owned by other roles without a reviewed PR.
6. Integration/test branch and deploy must be updated continuously, not only in last 30 minutes.

## 4. Suggested six-hour sprint (relative to official start, not a promise)
| Window | Dev A | Dev B | Dev C | Team gate |
|---|---|---|---|---|
| H1 | 3D placeholders, orbit camera, controls shell | Shared protocol + room skeleton | Routes/create/join/QR + contract skeleton | Code builds, three concurrent clients connect |
| H2 | Character scene, desktop movement, mobile joystick | Authoritative movement + stamina | Room UI + lobby ready/countdown | Live movement on desktop and phone |
| H3 | Mobile RUN/PASS, HUD, camera swipe | Passing/explosion/elimination, reconnect | Monad result signer + explorer UI | Full 3-player local match |
| H4 | Load KayKit/Kenney GLBs, optimize scene | Anti-cheat unit tests, bot opt-in if needed | Public backend/frontend deploy, wallet flow | HTTPS crossplay working |
| H5 | Target highlights, panic FX, low preset | Fix device latency/input races | Chain receipt and room results UI | Android+desktop+iOS E2E successful |
| H6 | Visual bugfix | Server bugfix | End-to-end QA, pitch demo, backup recording | Three successful matches + one proof tx |

**Scope cut order:** remove elaborate asset effects → advanced spectator camera → shrinking arena → bot implementation → optional testnet deposit escrow. **Do not cut mobile controls, authoritative stamina, basic multiplayer, result record** unless honestly demoing partial product.

## 5. AI agent role prompts (concise)
- **Game agent:** "Implement third-person orbit-follow with mouse drag + mobile right swipe, camera-relative normalized WASD/joystick movement, Shift hold/RUN toggle, E/PASS; input schema must be packages/shared; ensure multitouch pointerId isolation. Never author server result fields."
- **Backend agent:** "Implement 20Hz server-authoritative movement and stamina (5 bars, 1/s drain, 1.5s delay, 1/s regen), nearest valid bomb pass, one winner, reconnect; validate socket payloads with shared zod and deterministic clocks."
- **Web3/UI agent:** "Implement responsive room pages, create/join/Ready/countdown and Monad Testnet signed match result record; display virtual test-denominated points only. Never suggest real payout or treat fake off-chain points as deposits."
- **QA/reviewer agent:** "Search stale Dash/SPACE/isometric/mobile optional references; test cross-device joystick/right swipe, lack of sprint exploit, idempotent result registry and UI transaction honesty."

## 6. Demo-pitch dependencies
- Have QR code and guest-play mode reachable without new-wallet onboarding.
- Keep 3 clients ready (laptop, Android, iPhone), Wi-Fi and hotspot backup.
- If mobile in-app wallet steals focus, restore socket state and show match authority; avoid connecting wallets during time-critical bomb cycles.
- During pitch: create/join → ready → 15s countdown → 1 full match → last survivor → testnet transaction link.

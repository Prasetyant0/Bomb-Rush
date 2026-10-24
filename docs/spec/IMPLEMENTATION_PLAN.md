# IMPLEMENTATION_PLAN — v0.5 Sequenced Build Plan

**Scope reality:** v0.4's 6-hour estimate was for **result-only** recording; adding real testnet escrow, secure recovery and tests is a substantially larger change. No credible delivery guarantee exists for six hours. Schedule below uses *relative milestones and hard decision gates*, not promises.

## Before event (preflight)
- Get **testnet** MON for 4 wallets + server deployer/signer and gas; verify RPC/network/faucet; verify explorer transaction URL with a real testnet tx.
- Confirm with hackathon staff that a no-real-value competitive pool demo is allowed. If not, disable funded mode and pitch safe gameplay/result record only.
- Create repos, hosting, WSS working, testnet-only keys, wallet connectors on Android/iOS and emulator/device matrix.
- Commit `packages/shared` constants/types from `API_CONTRACT.md`, Solidity ABI from `SMART_CONTRACT_SPEC.md`, and pinned dependency versions BEFORE parallel feature branches.

## Three-developer workstreams
| Stage | Dev A — 3D/mobile | Dev B — game/server | Dev C — contract/web3/UX | Gate |
|---|---|---|---|---|
| G0 Contracts | Arena/controls scaffold | Shared types & session auth design | Escrow ABI, deadline invariants, unit/fuzz tests | Document consistency locked |
| G1 Funding | Render 3/4 players | Prepare/join/receipt verification and room map | Deploy local escrow, wallet UI; chain 10143 smoke tx | EXACT deposit + refund tested |
| G2 Gameplay | Third-person scene, WASD/joystick | 20Hz sim, pass, stamina, winner, countdown | Wire funded status, lobby/wallet mobile | 3 browsers move in sync; funded gating |
| G3 Settlement | HUD/bomb cue/landscape | Winner/settlement queue + chain reconciling | Testnet settle, prize claim/payout UI, receipts | One full happy path with verified payout |
| G4 Failure cases | Low-fps fallback and orientation | Restart logic, cancel/no winner | Deadline expiry, refund, malicious tests | Fund safety tests pass |
| G5 Demo | Visual cleanup | Latency & crash fixes | Backup recording, measured tx timing, pitch | 3 real devices + transactions + fallback |

## Hard dependencies / concurrency
- `SMART_CONTRACT_SPEC.md` + ABI + `API_CONTRACT.md` → deployed address → verified receipt ingestion → lobby funded/readiness → gameplay → settle → payout. Refund path and contract safety tests should exist **before first public funding**.
- Dev A can progress against mock snapshots from shared types, but mocks are never presented as genuine chain or live matches.
- Dev C contract scope has become significantly larger; owner B may assist receipt/indexer QA once engine stabilizes. No agent changes shared types unilaterally.

## Milestone DoD
- **M1 escrow:** all critical Foundry tests pass; `createRoom`, deposit, invalid funding, expiry/refund, settle/claim pass locally. Contract peer-reviewed at least by one other dev.
- **M2 wallet/lobby:** wrong-chain handling, exact amounts and verified receipt flow on Monad Testnet; 3/4-seat room not starting underfunded.
- **M3 gameplay:** crossplay authoritative; all passing/stamina tests; 20/30s nominal.
- **M4 payout:** successful `MatchSettled` and `PrizePaid` actual testnet receipts; result page displays independently.
- **M5 recovery:** backend crash with funded pool; after deadline permissionless expire, funds withdraw with wallet even without app server.
- **M6 demo:** complete run filmed as backup, tx hashes checked, pitch claims match measurements.

## Cut / stop decisions
1. Cut VFX, polished GLBs, extra pages, spectator/scoreboard.
2. Simplify visuals to primitive avatars, keep authoritative controls.
3. Simplify wallet UX but not receipt verification.
4. If P0 escrow + refund + payout safety cannot pass, **disable all paid transactions** and present partial gameplay prototype, with clear explanation that on-chain pool is design-only.

## Deliverables
Tagged repo commit, .env.example without keys, deployed-contract ABI/address and testnet chain ID, test tx hashes and URLs, full test run output, stage fallback recording, honest known issues. This documentation ZIP does **not** count as a completed implementation.

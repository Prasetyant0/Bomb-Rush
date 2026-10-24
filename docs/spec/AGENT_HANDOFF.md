# AGENT_HANDOFF — Team and AI Coding Agent Contract v0.5

## Ownership
| Owner | Writes | Not allowed to change without agreement |
|---|---|---|
| Dev A: Game visual | `apps/web/src/game/**`, `apps/web/src/input/**`, `apps/web/public/models/**` | Core GameRules, escrow ABI, live server values |
| Dev B: Server authoritative | `apps/server/src/**`, `packages/shared/**` first merge | Contract ABI without C approval; client-only keys |
| Dev C: Contract + Product | `contracts/**`, `apps/web/src/web3/**`, `apps/web/src/pages/**` | Game input semantics, server-controlled winner |
| Shared | `apps/web/src/ui/**`, root tooling/docs | Update only coordinated revision |

## Shared contract / merge rules
1. Read `DECISIONS`, `MVP_SCOPE`, `SMART_CONTRACT_SPEC`, `ESCROW_SECURITY`, `API_CONTRACT`, then `GAMEPLAY_CONTROLS` before writing code.
2. First merged commit pins ABI (method signatures/events/enum) and `game-protocol/0.5` types. Tests that check ABI shape run in CI.
3. Any protocol change must edit source docs, TypeScript shared package, Solidity ABI and tests **together**. No silent new socket event.
4. A frontend wallet address or tx hash is not proof of deposit. B verifies chain receipt and event, with session-bound wallet auth.
5. Only B can determine match winner. Only C's contract checks payout eligibility and double-spend. Do not allow Dev A UI to set winner/settlement.
6. Integrate against fake GAME snapshots early, but mock chain data must be clearly labeled and forbidden on production/demo routes.
7. If error path uncertain, do not simulate success. Expose explicit `FAILED` state, retry or refund path.
8. Never commit secret keys, addresses masquerading as real deployments, fabricated tx hashes, or verified fairness claims.

## Key state handoff
`RoomPublicState` owns `gameStatus` and `escrowStatus` separately. `settlement` in `MatchResult` may be PENDING, CLAIMABLE, PAID, FAILED, REFUNDABLE or REFUNDED. No old `entryCredits` fields. All amounts are wei strings.

## Prompts to delegate directly
**Agent A prompt:** "Implement BOMB RUSH v0.5 third-person browser arena exclusively from GAMEPLAY_CONTROLS and API_CONTRACT. Output mobile safe landscape HUD + WASD/Shift/E + joystick/RUN/PASS. Server snapshots are authoritative. Do not touch money logic or shared protocol."  
**Agent B prompt:** "Implement typed Fastify/Socket.IO server + wallet proof + verified receipt ingestion from API_CONTRACT and SYS. All funded-room readiness must be derived from contract state; 3–4 humans, exact quorum, authoritative 20Hz sim. No client winner authority. Follow cancellation recovery."  
**Agent C prompt:** "Implement TestnetPoolEscrow per SMART_CONTRACT_SPEC and ESCROW_SECURITY with full unit/fuzz/reentrancy/deadline tests, then wallet UI and verified payout/refund explorer states. Monad Testnet 10143 ONLY. Do not release fundable contract until tests and peer review pass. Never claim trustless fairness."  
**Integration QA prompt:** "Audit every active field and invariant across these docs, Solidity ABI, TypeScript shared types, frontend copy and server validation. Fail if retired v0.4 `entryCredits` used as active source, game starts underfunded, payout has no receipt, or refunds require live backend. Provide evidence and gaps."

## Merge gates
G0 protocol locked; G1 escrow safety tested; G2 3 funded seats and synced match; G3 result settles on chain; G4 prize paid/refunds tested; G5 3-device crossplay; G6 backup demo/claim review. Any red gate means do not call product fully complete.

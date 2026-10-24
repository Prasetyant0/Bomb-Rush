# BOMB RUSH 3D — Developer Pack v0.5

**Release:** v0.5-testnet-pool-spec · **Date:** 24 October 2026 · **Status:** implementation specification, NOT an implemented, deployed, audited or tested escrow.  
**Intent:** cross-device 3D hot-potato multiplayer (3–4 humans), funded with **Monad Testnet MON, no real-world value**; funded match result settles a winner-takes-all pool with an on-chain claim/payout route; canceled/expired matches are refundable.

> **STOP / SCOPE WARNING.** This is a testnet-only hackathon demonstration, not advice that a winner-takes-all wagering product is lawful in Indonesia. Confirm organizer rules; do not advertise mainnet use, real-value prizes, real deposits, returns, or compliance certification. Do not deploy the escrow on mainnet with this pack. No codebase or live contract is included in this archive; security properties below are requirements requiring implementation, review, and tests.

## What changed from v0.4

- Replace *virtual demo credits* and result-only `MatchRegistry` with **real testnet-native MON deposits held by a single purpose-built escrow contract**; no redeemability or monetary value.
- Require a wallet on funding-mode seats. Host creates room + deposits in one wallet transaction; subsequent players join and deposit exact amount.
- Separate **game status** from **contract funding/settlement state**, use event/receipt reconciliation. Lobby cannot COUNTDOWN until on-chain FUNDED, 3/4 valid funded unique wallets, and everyone ready.
- Terminal WIN does not equal paid. **Winner has an immutable claimable allocation after settlement**; a backend relayer automatically triggers permissionless `payout()` after verified settlement (with anyone-can-call fallback), and explorer proves transfer only after receipt confirms it.
- Support cancellation, timed out funding, and expired resolution with **permissionless withdrawRefund**, funded entirely by contract holdings. No money gets stuck only because app server restarted.
- Keep gameplay/cross-device invariants from v0.4: radius 7; 3–4 humans; 10-second bomb cycles; pass never resets the timer; WASD/Shift/E and mobile landscape joystick/RUN/PASS; 20/30 seconds nominal gameplay.

## One-sentence pitch
"BOMB RUSH is a fast cross-device survival arcade game whose testnet match pool and winner settlement are transparent on Monad, while responsive gameplay remains server-authoritative off-chain."

## Hierarchy / single source of truth
1. **DECISIONS.md** resolves product tradeoffs, security trust assumptions, and scope.
2. **SMART_CONTRACT_SPEC.md** owns contract states, invariants, entry/funding/refund/claim semantics.
3. **API_CONTRACT.md** owns constants, application types, HTTP and Socket.IO messages.
4. **GAMEPLAY_CONTROLS.md** owns controls and gameplay, unchanged by economic architecture.
5. **MVP_SCOPE.md** determines which requirements must actually ship; remaining docs must not expand it.
6. Security gate **ESCROW_SECURITY.md** overrides any plan to ship funds handling without recovery/tests.

If any documents conflict: correct the source of truth **before writing code**. Do not silently implement contradictory assumptions.

## Read order for three devs / AI agents
`DECISIONS.md` → `MVP_SCOPE.md` → `SMART_CONTRACT_SPEC.md` → `API_CONTRACT.md` → `GAMEPLAY_CONTROLS.md` → `SYS.md` → `AGENT_HANDOFF.md`.

## Contents (21 authored specifications)

| Document | Purpose |
|---|---|
| `DECISIONS.md` | Locked design choices, explicit exclusions, trust model |
| `MVP_SCOPE.md` | P0/P1/P2 and go/no-go release conditions |
| `SMART_CONTRACT_SPEC.md` | Escrow ABI, state machine, safety invariants |
| `ESCROW_SECURITY.md` | Threat model, misuse tests, fail-safe refund path |
| `API_CONTRACT.md` | Canonical types, endpoints, socket events, constants |
| `GAMEPLAY_CONTROLS.md` | Timers, controls, movement, stamina and passing |
| `SYS.md` | Architecture, state boundaries, event reconciliation |
| `TRD.md` | Stack, Solidity/Web3 integration, deploy configuration |
| `PRD.md` | User stories, pages and acceptance requirements |
| `BRD.md` | Value proposition, audience, risks and evidence |
| `design.md` | Monad palette, responsive UX, wallet/escrow interaction |
| `FLOWCHART.md` | Full user journey, settlement, timeout and failure diagrams |
| `QA_CROSSPLAY.md` | Browser/device and chain state QA release gates |
| `IMPLEMENTATION_PLAN.md` | 3-person dependency-aware sprint and cut strategy |
| `AGENT_HANDOFF.md` | Agent ownership and strict integration protocol |
| `DEMO_RUNBOOK.md` | Exact live demo and honest fallbacks |
| `PITCH_SCRIPT.md` | Three-minute narrative and expected jury objections |
| `MONAD_PERFORMANCE.md` | Instrumentation, metrics, safe performance claims |
| `ERD.md` | Logical persistence reference, chain as funds source of truth |
| `CHANGELOG.md` | v0.4 → v0.5 breaking changes |
| `AUDIT_CHECKLIST.md` | Release audit and cross-document checks |

## Known limitations of the hackathon demo
- The **operator/server remains a trusted winner oracle**. On-chain pool visibility and a result hash do NOT establish trustless gameplay or fairness.
- The operator key can settle any funded match to an eligible deposited participant unless a stronger proof/permission system is added later.
- With no database, in-flight game rooms can disappear on process restart. **Contract balances survive**; after timeouts, users can cancel expired contracts and withdraw refunds.
- `payout()` / `withdrawRefund()` are transactions. Wallet confirmation, RPC inclusion, and indexer times may exceed sub-second protocol finality. Do not promise "instant" payout.
- The pack is unimplemented. Test results, security audit, benchmark data, contract address, screenshots and tx hashes must be supplied by the actual team, not fabricated.

## Monad network facts and references
- **Testnet only:** chain ID `10143`, native symbol `MON`, RPC `https://testnet-rpc.monad.xyz`, faucet `https://faucet.monad.xyz`.
- Choose and verify explorer URL against a real confirmed tx during preflight; frontends must not generate an unverified explorer link.
- Official starting points: https://docs.monad.xyz/ ; https://github.com/monad-developers ; https://monad.docsbot.app/ai/current-facts
- Monad's 10K+ TPS is an architecture/capacity claim; it is NOT a BOMB RUSH measurement. Distinguish chain inclusion/finality from UI → wallet → confirmation end-to-end latency.

**Design baseline:** rewritten using accessible v0.4 documents and conversation-level notes of the v0.4.1 simulator audit. Actual v0.4.1 committed files were not provided for file-level diff; the 52/52 audit claim is NOT asserted for this new pack.

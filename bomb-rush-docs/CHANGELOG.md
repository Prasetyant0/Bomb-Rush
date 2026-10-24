# CHANGELOG — BOMB RUSH Developer Pack

## v0.5 — 24 October 2026, Testnet Pool Architecture Rewrite
**BREAKING** against v0.4 result-only virtual-credits contract:

1. Product: select fixed native **test MON** per player rather than `entryCredits`; 3/4 human-funded seats. Monad Testnet ONLY; no monetary value, no mainnet.
2. Contract: new purpose-built escrow (`createRoom`, `joinRoom`, `settle`, `payout`, `cancelRoom`, `expireUnfunded`, `expireUnresolved`, `withdrawRefund`). The v0.4 `recordMatch` contract and guest winner zero address are **not** P0-funded interfaces.
3. API: typed wei string amounts, wallet-authenticated seat, chain receipt validation; `GameStatus` separate from `EscrowStatus` and `SettlementView`.
4. Safety: permissionless post-deadline expire/refund and independently callable prize payout; contract balance remains recoverable without application server.
5. UI: wallet network validation, create+fund, deposit status, pool transparency, claimable vs paid, recovery screen.
6. QA: add contract property/fuzz/abuse/reentrancy and cross-device wallet deep-link tests; full recovery/no-double-payment stop-ship criteria.
7. Schedule: prior six-hour scope estimate **no longer assumed feasible**. Define gates; never cut refund safety while accepting deposits.
8. Pitch: fast off-chain gameplay + on-chain testnet pool, measured wallet-to-receipt evidence; no unsupported 10K TPS benchmark or provably fair claim.
9. New docs: `SMART_CONTRACT_SPEC.md`, `ESCROW_SECURITY.md`, `MONAD_PERFORMANCE.md`, `AUDIT_CHECKLIST.md`.
10. Game rules carried forward: 3–4, radius7, 10s bomb cycle, no pass timer reset, 20/30s nominal, 15s lobby countdown, stamina/passing/cross-device control rules.

### Explicitly not verified
This document pack has not compiled or tested a Solidity contract or run a real-match test; no actual deployed address, receipt or benchmark results are supplied. The accessible reference set is v0.4; v0.4.1 simulator binaries/results were not provided for file-level comparison. A doc lint pass is not a security audit.

## v0.4 — 23 October 2026 (historic baseline, superseded for economic flow)
Result-only chain record, no deposit/escrow/refund, virtual demo credits, operator server-authoritative gameplay, mobile P0, short match timing corrected, in-memory sessions. Preserved gameplay rules; replaced economic architecture.

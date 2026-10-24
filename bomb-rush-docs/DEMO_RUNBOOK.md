# DEMO_RUNBOOK — Honest Live Demo (v0.5)

## Before pitching
- Confirm organizer permits testnet pool-style demo. Use testnet-only wallets with small token amounts and enough gas; avoid any wallet containing real funds.
- Open RPC, deployed contract (verified code if supported), correct chain ID 10143, and verified testnet explorer. Copy actual contract address, room IDs and tx links to private operator note, not invented here.
- Prepare 3 devices (laptop, Android, iPhone) or 3 separate authenticated wallets/browser windows if hardware limited; **never start 2-human room**. Three distinct wallets, each with test MON.
- Test one complete create+fund→join→settle→payout and one timeout→refund in advance. Confirm receipt proof in explorer. Have a backup screen recording labeled **recorded demonstration**, not live.

## Live flow (target 2–3 minutes, network latency varies)
1. Say: "Everything uses worthless test MON on Monad Testnet; no real money or redeemable winnings."
2. Show **Create Room**: 3 human seats, e.g. 0.001 test MON contribution each (only if funded wallets can pay; amount illustrative). Host signs creation/deposit.
3. Verify creator `RoomCreated + DepositConfirmed` in explorer or status UI, then share six-letter code.
4. Two players join with own wallets; each checks entry and signs deposit. Show three confirmed on-chain members and pool = 3 × entry, **verified contract pot**.
5. Three Ready. Server 15s countdown; start match. Explain: 10-second bomb cycle, passing never resets timer; WASD/Shift/E or joystick/RUN/PASS.
6. Show first elimination then second; server declares last survivor. Display `RESULT DECLARED` then `SETTLEMENT PENDING` explicitly.
7. When `MatchSettled` receipt confirmed, display `PRIZE CLAIMABLE`. Confirm that the server automatically triggers `payout(roomKey)` after settlement; if relayer is down, invoke it manually (permissionless trigger) and show **actual `PrizePaid` receipt**, not only a wallet balance animation.
8. Optional: show separate pre-created canceled test room and on-chain refund receipt. State that expired refund path works without game server.
9. Close: "Fast interactive gameplay off-chain; transparent testnet deposits and pool settlement on Monad. The server remains trusted to report the winner."

## Stopwatch/claim hygiene
If talking about speed, report actual measured UI→wallet→receipt latency and sample count. Monad's claimed 10K TPS capacity is not a metric from this demo. A 0.6s protocol finality claim does not guarantee 0.6s wallet UX.

## Five failure branches
| Failure | Visible response / next action |
|---|---|
| Wallet rejected / wrong network | Switch to chain 10143, retry; no fake deposit |
| RPC delayed | Show pending chain status and existing confirmed proof; don't claim speed |
| Mobile rendering fails | Low-poly primitive fallback; same rules, no silent mobile exclusion |
| WebSocket/server crashes | No fake winner; after resolution deadline permissionless expire and refund by wallet; explain limitation |
| Settlement/payout fails | Show actual failed status and available retry or timeout recovery; use pre-recorded labeled evidence if needed |

## Specific demo contract recovery instructions
- With game website offline, open EVM wallet/verified block explorer contract write UI (or maintained minimal static recovery page), select **Monad Testnet 10143**, verify deployed address from signed release note.
- Read `getRoom(roomKey)` and `hasDeposited(roomKey,myAddress)`; after FUNDING deadline on partially funded room call `expireUnfunded`; after RESOLUTION deadline on FUNDED unresolved room call `expireUnresolved`.
- Once `CANCELED`, `withdrawRefund(roomKey)` from **original depositor wallet**. `SETTLED` cannot be refunded; if prize unpaid use `payout(roomKey)`.
- Do not tell anyone to share private keys or seed phrases. Use gas-bearing testnet wallet.

## Pitch claim checklist
NEVER state: "audited escrow", "trustless fair gameplay", "instant guaranteed payout", "10,000 TPS measured", "real winnings", "legal approval", "we finished X tests" without evidence. Honest implementation caveats build more credibility than unsupported performance slogans.

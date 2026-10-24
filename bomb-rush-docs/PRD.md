# PRD — Product Requirements v0.5

## Product / audience
BOMB RUSH is a 3–4 person cross-device 3D game. A funded room uses equal **test MON without monetary value** and transparently allocates its contract pool to the last survivor, with an explicit claim/payout and cancellation/refund path. Primary users: fast casual friends; room host; hackathon judge evaluating full stack and verifiable chain receipts.

## User journeys
### Host
1. Open landing page → choose **Create Funded Testnet Room**.
2. Connect EVM wallet, change/check Monad Testnet 10143; see `TESTNET ONLY — NO REAL VALUE`.
3. Choose 3 or 4 seats, demo entry amount shown per player in MON, fixed pool estimate `amount × maxSeats`, note gas additional. Review contract/timeout.
4. Sign `createRoom` transaction that also deposits host entry. Wait for confirmed room event; see shareable code & stable roomKey link. If rejected, return to entry form without phantom room.
5. Share link; observe real funded count and who is ready. Press Ready after host deposit verified. All deposits confirmed and all ready → automatic 15s countdown.
6. Play match, see result, on-chain settlement status and payout receipt; rematch creates fresh contract room, never reuses paid pool.

### Joiner
1. Enter invite code or direct roomKey URL → view entry, total pool, seat count, deadline, host, escrow contract address and testnet disclaimer **before signing anything**.
2. Connect wallet + sign address proof → choose Join & Deposit; check wallet request exact `msg.value`; wait for confirmed receipt.
3. If seat filled or funding deadline elapsed, disable join, no transaction sent. After confirmed deposit: Ready, match, result, optional payout trigger if winner.
4. If match canceled, see Refund Available and call `withdrawRefund(roomKey)` from funded wallet; verify chain status after receipt.

## Required screens and states
| Screen | Elements | Edge/empty/error |
|---|---|---|
| Landing | Hero, create/join, how to play, testnet banner | No wallet = can browse help, cannot fund |
| Wallet connect | Address, switch chain, gas notice, recovery | Rejected wallet/no provider/wrong chain |
| Create room | 3/4 seats, entry input/presets, contract detail, duration, create+fund CTA | Invalid amount, insufficient gas, tx rejected, duplicate create |
| Join by code | 6-character readable entry, room on-chain summary | Not found/full/expired/already deposited |
| Funding lobby | Depositor seats, CONFIRMED badge from chain, contribution amount, total pool, deadline, Ready, invite | Pending Tx, refunded/canceled, no ready until funded |
| Countdown | 15s server sync, no late join | Funding revoked/on-chain canceled → return/cancel |
| Arena | 3D play, overhead bomb, 10s timer, alive count, stamina, contextual controls | Disconnect/reconnect, portrait rotate, low FPS |
| Results | Winner, immutable match result, settlement pending/claimable/paid, tx hashes and explorer | RPC failure, claim retry, unresolved expiry path |
| Refund recovery | Contract reads, expired cancel button, claim refund, tx receipt | Backend offline, already claimed, pending tx |

## Acceptance criteria (P0)
- Users explicitly acknowledge testnet nature. No actual money or real reward copy, never show real MON rates or APY.
- Host can't create funded room without valid wallet; wallet required for funded participation.
- Player can't ready until on-chain deposit matches room, wallet, contract, value, chain and successful receipt.
- No game starts while partially funded or under 3 players; max seats selected exactly met.
- All game actions server-authoritative and device-neutral; 3-player=20s / 4=30s nominal.
- Never show 'paid' until `PrizePaid` receipt/chain state confirms; settlement alone means claimable.
- Cancellation and deadline expiry permit exact once refunds; user can recover with roomKey and wallet when game server is offline.
- Errors have direct retry/back-to-lobby/recover path; no dead-end modals.

## Copy guidelines
- Use "Test MON", "Monad Testnet", "No real value", "testnet pool", "funding", "settled" and "claim prize".
- Avoid "real winnings", "real money", "gambling guaranteed legal", "instant payout", "fairness proven", and "earn money".
- Display fee=0 platform fee; network gas still applies. Show pot as test MON, always labeled testnet.

## Success signals (report actual measurements only)
Three real devices can finish match; receipt-verified deposits, a single valid settlement, confirmed payout, and refund test recorded; onboarding friction measured; frontend responsive. Nothing about network capacity is inferred from one match.

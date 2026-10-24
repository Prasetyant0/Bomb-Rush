# MONAD_PERFORMANCE — Evidence Protocol v0.5

## What can be claimed
- Monad advertises **10K+ TPS capacity**, approximately **300ms block production** and **600ms protocol finality** in its documented architecture (check official current facts before pitching). These are **network characteristics, NOT observed BOMB RUSH throughput**.
- A BOMB RUSH testnet measurement is at best a sample of client/wallet, RPC/network, chain inclusion, receipt availability and UI rendering. Do not equate one successful quick transaction with a 10K TPS stress test.
- Parallel multi-room transactions could explore app-level throughput, but this MVP does not run a synthetic network load test, nor claim to saturate Monad.

## Instrument each transaction path
For `createRoom`, `joinRoom`, `settle`, `payout`, `expire`, `withdrawRefund`, log all timestamps in ISO 8601 UTC and monotonic client intervals if possible:
| Field | Definition |
|---|---|
| `operation` | create/join/settle/payout/expire/refund |
| `roomKey` | pseudonymous contract room identifier |
| `walletPromptOpenMs` | before wallet opens confirmation |
| `walletApprovedMs` | after user approves (not necessarily tx broadcast) |
| `txSubmittedMs` | RPC returns tx hash |
| `txFirstSeenMs` | optional first mempool/explorer observation |
| `txReceiptObservedMs` | first successful receipt verification |
| `receiptBlockNumber` | block containing tx |
| `uiConfirmedMs` | first UI confirmed status |
| `status` | success, revert, rejected, timeout, retry |
| `txHash` | actual on-chain tx hash |
| `provider` | RPC endpoint/vendor; note connection mode |
| `device` | desktop/iOS/Android, browser version |

## Computations
- `wallet interaction latency = walletApprovedMs - walletPromptOpenMs` (human decision time).
- `broadcast→receipt = txReceiptObservedMs - txSubmittedMs` (client-observed, includes RPC polling overhead).
- `end-to-end confirmation = uiConfirmedMs - walletPromptOpenMs` (experience, includes human time).
- `settlement e2e = PrizePaid receipt - match end` (includes oracle and two contract operations).
- `success rate = verified successful operations / attempted operations` by operation and device. Report n and any exclusions.
- Present **median/p50, p95, max, count, failure rate**, rather than cherry-picking fastest sample. For n<20, call the results small-sample observations and explain p95 instability.

## Example reporting template (fill with observed data ONLY)
| Operation | n | p50 s | p95 s | Failed | Links |
|---|---:|---:|---:|---:|---|
| create+deposit | — | — | — | — | — |
| join+deposit | — | — | — | — | — |
| settle | — | — | — | — | — |
| payout | — | — | — | — | — |
| refund | — | — | — | — | — |

## Experimental control
Same testnet chain ID, same contract version, stable RPC, timestamp capture on actual devices, keep screenrecord/wallet time and event logs. Run multiple independent rooms sequentially, avoid reusing funds by accidental live-state assumption. If RPC providers differ, stratify metrics. Avoid deliberately spamming network or exceeding public RPC limits.

## Judge-friendly claim
"We designed the demo around Monad's fast settlement and measured our own wallet-to-receipt latency on testnet. We do not treat 10K+ TPS, the network's capacity figure, as a benchmark of this application."

Sources to revalidate on demo day: https://monad.docsbot.app/ai/current-facts ; https://docs.monad.xyz/ ; https://github.com/monad-developers

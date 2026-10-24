# QA_CROSSPLAY — v0.5 Release Matrix

**Test environment:** local EVM (contract safety), Monad Testnet 10143 (integration), real browsers (crossplay). Testnet economic flow needs test funds for gas and exact deposits; never substitute screenshots of receipts.

## A. Real device crossplay
| ID | Scenario | Expected |
|---|---|---|
| CP01 | Desktop Chrome + Android Chrome + iPhone Safari same URL | HTTPS/WSS, joins work, no console-critical errors |
| CP02 | Portrait mobile create/join | No horizontal overflow, correct keyboard/wallet |
| CP03 | Landscape mobile gameplay | Controls clear of browser safe areas |
| CP04 | Joystick + camera swipe simultaneously | Both independent |
| CP05 | Joystick + RUN + PASS simultaneous | Predictable movement and pass |
| CP06 | Desktop WASD + Shift + drag | Server agrees input and stamina |
| CP07 | Cross-device bomb pass | All agree one holder and timer |
| CP08 | 3-player full match | Two 10s bomb cycles, only one winner |
| CP09 | 4-player full match | Three 10s bomb cycles, only one winner |
| CP10 | Rotate to portrait mid-game | Overlay shown, server continues ticking |
| CP11 | iOS wallet deep-link return | Same seat, no double fund or lost session |
| CP12 | Background 4s then foreground | Release pointers; snapshot recovers |
| CP13 | Low-end phone | ≥30fps target via fallback; no gameplay advantage |
| CP14 | Two-player room | Cannot start (must 3), no bot substitution |
| CP15 | Attempt to send custom winner/position | Backend rejects; contract rejects non-settler |

## B. Funding and receipt verification
| ID | Scenario | Expected |
|---|---|---|
| CH01 | Host creates with exact entryWei | Receipt, RoomCreated and host DepositConfirmed |
| CH02 | Player joins exact amount | One unique funded seat, contract count advances |
| CH03 | Wrong value or 0 | Revert, no funded seat |
| CH04 | Same wallet joins twice | Revert, no double counting |
| CH05 | Transaction hash from wrong room | Rejected by backend |
| CH06 | Tx from wrong chain/contract or reverted | Rejected, no funded badge |
| CH07 | Wallet rejects | No funded status, clear retry |
| CH08 | One player still pending | Lobby blocks countdown |
| CH09 | 4-seat room with 3 funded | No countdown or forced 3-player fallback |
| CH10 | Wallet address spoof in REST | Session signature binding rejects |
| CH11 | Deadline passed | Join rejected, expire path visible |
| CH12 | Duplicate log delivery/reconnect | Idempotent funded status |

## C. Settlement/payout/refund invariants
| ID | Scenario | Expected |
|---|---|---|
| ST01 | Only settled after full funded valid match | One eligible winner; MatchSettled |
| ST02 | Call settle as ordinary wallet | Revert |
| ST03 | Settle with non-depositor/zero winner | Revert |
| ST04 | Settle twice | Revert |
| ST05 | Payout before settlement | Revert |
| ST06 | Payout twice | Revert / no second transfer |
| ST07 | Third party triggers payout | Funds still sent to recorded winner |
| ST08 | Payout recipient rejects transfer | Revert, winner still claimable |
| ST09 | Cancel before/full funding (authorized) | Refunds available |
| ST10 | ExpireUnfunded after deadline | Permissionless and refunds |
| ST11 | ExpireUnresolved after deadline | Permissionless and refunds |
| ST12 | Same wallet withdrawRefund twice | Second reverts |
| ST13 | Settle then attempt refund | Reverts |
| ST14 | Cancel then attempt settle | Reverts |
| ST15 | Concurrent settle and expire | Exactly one transition wins |
| ST16 | Kill backend with funded room | Wallet can expire/claim refund after deadline |
| ST17 | RPC outage during payout | UI never marks paid without chain proof |
| ST18 | Contract fuzz: balance conservation | Pool never overspent, allocations exact |

## D. Timings / test instrumentation
Record local `wallet_request_ms`, `tx_submitted_ms`, `tx_receipt_ms`, `ui_verified_ms` and tx hash for create, join, settle, payout, refund. Never interpret provider RPC delay as TPS. Keep network conditions and count; 3 demo transactions are not a throughput benchmark.

## E. Go/no-go
**GO FUNDED DEMO** only if ST01–ST18 and CH01–CH12 pass on local tests, all critical happy-path verified testnet, CP01/CP08/CP09 crossplay pass, and safe cancel/refund confirmed. Owner signs off `AUDIT_CHECKLIST.md`.  
**NO GO:** failed refund, overpayment, possible double-payment, fake confirmation, unverified signer, or missing device controls. Fall back to honest UI-only demo with on-chain funding OFF.

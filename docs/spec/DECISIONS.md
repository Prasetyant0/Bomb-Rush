# DECISIONS — v0.5 Frozen Product and Engineering Decisions

## Product and scope
| ID | Locked decision | Rationale |
|---|---|---|
| D01 | Monad TESTNET only, chainId=10143, test MON has no real economic value | Hackathon sandbox; no mainnet value path |
| D02 | 3–4 **human** players; single room host is a player; no demo bot in P0 | Avoid false occupancy and opaque operator play |
| D03 | Each funded player deposits equal exact native test MON; host chooses preset amount before room creation | Transparent equal contributions |
| D04 | Entry immutable once contract room created; on-chain balances are source of truth | No frontend-only fictitious pool |
| D05 | 100% of funded pool reserved for eligible winner; **0 platform fee** | Unambiguous demo |
| D06 | Host creates room and funds own seat in one on-chain call; others `joinRoom` payable | Minimize transactions |
| D07 | Wallet required for pool mode; guest practice is a **separate P1 flow** with no deposits or payout | Payout must have a known address |
| D08 | Backend controls authoritative gameplay and winner; settlement key is trusted; never claim trustless fairness | Short 6-hour build cannot prove game state on chain |
| D09 | `settle` credits a **claimable prize**; the backend auto-triggers permissionless `payout(roomId)` to winner, with manual recovery trigger; use checks-effects-interactions | Safe payout and clear status distinctions |
| D10 | Cancel/expire enters refundable state; each participant **pulls** their own exact deposit once | No operator dependency for recovery after timeout |
| D11 | A funded unresolved room is refundable after a bounded resolution deadline | Funds cannot be indefinitely locked by dead backend |
| D12 | Separate `GameStatus`, `EscrowStatus`, `TransferStatus`; do NOT reuse v0.4's five-value status for chain | Prevent frontend/contract state drift |
| D13 | Admission locks when game countdown begins; contract must also be fully funded first | No phantom/late seat |
| D14 | Deploy single instance, in-memory live game, **reconstruct contract state from reads/logs** | Keep scope small; deposits survive restart |
| D15 | Room codes are 6 chars uppercase, avoid 0/O/1/I; contract key is `bytes32` unique per room; backend maps code→key | Human-friendly, collision-resistant |
| D16 | No pooling of real value, no deposits on mainnet, no conversion/redemption | Hard product prohibition |
| D17 | After 15 s lobby countdown, 3 players=20 s and 4 players=30 s *nominal gameplay* | Preserve v0.4 established mechanics |
| D18 | No automatic unconditional `settle` before server emits authenticated result and reconciles funded wallet list | Prevent forged winner from client |

## Timeouts (source of truth for pool defaults)
- `ENTRY_MIN_WEI=10^15` (0.001 test MON), `ENTRY_MAX_WEI=10^16` (0.01 test MON), default 0.001, presets 0.001/0.005/0.01 test MON. Configurable only through a versioned shared-contract decision; the contract enforces bounds.
- `FUNDING_WINDOW_SEC=600` from confirmed contract room creation.
- `RESOLUTION_WINDOW_SEC=1200` from confirmed contract room creation (absolute; includes funding time). At expiration a funded but unsettled room may be canceled by **any caller** and refunded. Deadlines are UNIX seconds (EVM timestamps), not milliseconds.
- P0 cancellation: contract operator may call `cancelRoom` for an outstanding non-settled room, providing a documented reason; host cannot arbitrarily cancel after funding. Any caller may call `expireUnfunded` or `expireUnresolved` once their deadlines pass.
- If `settle` and `expireUnresolved` contend, whichever legally changes escrow state on chain first wins; the other must fail. App MUST reconcile receipt and read latest contract status before showing success.

## Gameplay invariants frozen from v0.4
`MIN_PLAYERS=3`, `MAX_PLAYERS=4`, `ARENA_RADIUS=7`, `PLAYER_RADIUS=.4`, `MAX_POSITION_RADIUS=6.6`, `WALK=4.5u/s`, `SPRINT=7u/s` provisional, `STAMINA_MAX=5`, drain `1/s`, regen delay `1500ms`, regen `1/s`, `BOMB_CYCLE=10s`, pass range `1.8u`, pass cooldown `700ms`, anti-return `1000ms`, countdown `15s`, reconnect grace `5000ms`, server sim `20Hz`, snapshots `15Hz`, pass timer never resets.

## Key trust / security assumptions
- Only the designated server signer (`SETTLER_ROLE`) may settle. Address and role are public on chain. Owner/admin key is not kept in frontend; separate deployer/admin vs runtime signer. Limit deployer's powers; test only.
- Winners MUST be an address in that room's **actual depositors**, with no empty, replaced, or duplicate player slots.
- Rooms **cannot** finish/payout if on-chain funding count < selected seats.
- Code-scanning a tx hash is not evidence until its **receipt** matches correct chain, contract, room, sender, value, success, and event. Never trust client-provided `funded=true`.
- A player wallet may fund at most one seat of the same room (one wallet, one seat), but sybil across distinct wallets is out of scope. Do not claim sybil resistance.

## Release trade-off / cut rule
P0 **must** include secure funding, winner settlement, refund recovery, and multiplayer. If those cannot pass release gates, present a clearly labeled **UI/gameplay demo only** (no deposits) and mark testnet economic flow unfinished. NEVER cut refund while allowing deposits.

## Hard exclusions
Mainnet, real monetary stakes, platform rake, tokens convertible to value, hidden bots, provably fair game claims, VDF/ZK result verification, on-chain player movement, NFTs, ranking economy, testnet faucet bypass, referral schemes, unattended production operation.

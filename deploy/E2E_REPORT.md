# E2E Report — escrow round trip on a real local chain

Date: 2026-10-24
Scope: `scripts/` and this file. No contract, app or package source was modified.
Chain: local anvil, chainId 10143, `http://127.0.0.1:8545`.
Toolchain: anvil/forge/cast 1.6.0-nightly, jq, node.

Every assertion below is a real `cast call` or a real mined `cast send` against
the deployed `TestnetPoolEscrow`. Nothing is mocked.

## Result

| Path | Room | Result |
|---|---|---|
| A — happy path | roomA | **GREEN** — create 3 seats, 2 joins, settle, third-party payout; winner received exactly the pot; contract balance returned to its pre-path value |
| B — timeout + refunds | roomB | **GREEN** — create, 2 joins, warp past `resolutionDeadline`, permissionless `expireUnresolved`, 3 × `withdrawRefund`; each depositor got exactly `entryWei` back |

`scripts/e2e-escrow.sh`: **24/24 steps passed, 62 transactions, all mined, exit 0.**
`scripts/check-balance-conservation.sh --allow-baseline`: **0 checks failed, exit 0.**

## Reproduce

```bash
cd "D:/LOMBA ABYAN/Monad/bomb-rush"

# 1. Bring up (or reuse) the local chain and write scripts/.local-chain.env.
#    Idempotent: reuses a live chain that still answers with the right roles.
scripts/dev-chain.sh

# 2. Full harness. Fail-fast by default; --keep-going runs every step and exits non-zero.
scripts/e2e-escrow.sh

# 3. Independent re-derivation from chain state + recorded receipts.
#    --allow-baseline accepts a non-zero starting contract balance left by an
#    earlier aborted run (see "Dirty-chain behaviour" below).
scripts/check-balance-conservation.sh --allow-baseline
```

Run artifacts land in `scripts/.local-chain/chain-127_0_0_1_8545/`:
`txlog.jsonl`, `rooms.json`, `snapshot-before.json`, `snapshot-after.json`,
and `rejecting-helper.env` when the ST08 helper had to be redeployed.

## Step → QA_CROSSPLAY mapping

| Step | What actually executed | ST-IDs |
|---|---|---|
| 1 preflight | chainId, admin holds `DEFAULT_ADMIN_ROLE`, settler holds `SETTLER_ROLE` only, 4 distinct signers, `entryBounds()` bounds checked on chain | — (ST02 setup) |
| 2 A1 createRoom | 3 seats, host pays exactly `entryWei`; receipt carries `RoomCreated` **and** host `DepositConfirmed` | CH01, ST01 (setup) |
| 3 A2 joinRoom ×2 | each join pays exactly `entryWei`; count 1→2→3; pot tracks `entryWei × count` | CH02 |
| 4 A3 funded | `depositCount == 3`, status FUNDED, pot `== 3 × entry`, depositor order, `RoomFunded` once | CH02, ST18 (pot identity) |
| 5 A4 settle | from `SETTLER_ROLE`; status SETTLED; winner + resultHash stored; `prizePaid` still false; `MatchSettled` once | ST01 |
| 6 A5 payout (third party) | outsider triggers `payout()`; winner receives exactly the pot; caller receives nothing; contract delta returns to baseline | **ST07**, ST06 (complement) |
| 7 B1 fund roomB | 3/3 funded, never settled | CH02 |
| 8 B2 expire | `expireUnresolved` before deadline reverts `DeadlineNotPassed()`; after warp, permissionless from a non-depositor; CANCELED / `RESOLUTION_TIMEOUT` | **ST11**, CH11 |
| 9 B3 refunds | each of 3 depositors: net `+entryWei − own gas`; `refundWithdrawn` true; contract delta back to baseline | ST11 (refund arm), ST18 |
| 10 N0 fixture | FUNDED roomN as the target for settle attacks | — |
| 11 N1 | settle from host (no role) and from admin (role separation) both revert `AccessControlUnauthorizedAccount`; mined tx reverts, no state change | **ST02** |
| 12 N2 | settle naming a non-depositor → `WinnerNotDepositor()`; `address(0)` → `ZeroWinner()`; zero resultHash → `ZeroResultHash()` | **ST03** |
| 13 N3 | second `payout()` on the settled room reverts `PrizeAlreadyPaid()`; winner balance unmoved | **ST06** |
| 14 N4 | `withdrawRefund` on a SETTLED room reverts `AlreadySettled()`; payout delta is gas only | **ST13** |
| 15 N5 | second `withdrawRefund` from the same wallet reverts `RefundAlreadyWithdrawn()` | **ST12** |
| 16 N6 | `settle` on a CANCELED room reverts `AlreadyCanceled()` | **ST14** |
| 17 N7 | `payout` on a FUNDED room reverts `NotSettled()`; both pots stay escrowed | **ST05** |
| 18 N8 | second `settle` reverts `AlreadySettled()`; recorded winner not overwritten | **ST04** |
| 19 N9 | `settle` on a 1-of-3 room reverts `NotFunded()` | ST01 (negative guard) |
| 20 ST09 | `cancelRoom` from settler reverts; admin cancel → CANCELED / `OPERATOR_ABORT`; host then refunds `+entry − gas` | **ST09** |
| 21 ST08 | `RejectingDepositor` funds a seat; settle names it winner; `payout` reverts `TransferFailed()`; `prizePaid` stays false and the pot stays on chain; after `disarm()` the retry pays out | **ST08** |
| 22 ST15 | after cancel: settle + expire both revert; on the settled roomA: cancel + expire + expireUnfunded all revert; replaying roomA's payload at roomF reverts. One-block boundary race: `expireUnresolved` mined true, competing post-deadline `settle` mined false | **ST15** |
| 23 ST10 | `expireUnfunded` before deadline reverts; after warp, permissionless from a non-depositor; join after deadline reverts `DeadlinePassed()` and count does not advance; non-depositor refund reverts `NotDepositor()`; host refunds `+entry − gas` | **ST10**, CH11 |
| 24 drain | settle+pay roomN and roomC; refund roomF and roomH; final contract delta == 0 | ST18 |
| — conservation | independent re-derivation: contract back to baseline, every room terminal, `sum(wallet delta + gas) == 0` | **ST18** |

## PROVEN

ST01, ST02, ST03, ST04, ST05, ST06, ST07, ST08, ST09, ST10, ST11, ST12,
ST13, ST14, ST15, ST18.

## NOT PROVEN (and why)

| ST-ID | Why not proven here |
|---|---|
| **ST16** — kill backend with a funded room, wallet can expire/claim refund | The harness has no backend in the loop. The *contract* half is proven: roomB's expire and refunds (step 8–9) and roomG's `expireUnfunded` (step 23) execute with no server, settler or admin involvement. The claim that a dead backend cannot block recovery requires the app, which is out of scope. |
| **ST17** — RPC outage during payout, UI never marks paid without chain proof | Requires a client UI and a fault-injected RPC. Nothing in `scripts/` renders or marks a payment. Out of scope. |
| ST01 (positive arm, full) | The contract-side assertion (settle only from a fully funded room, one winner, `MatchSettled` emitted) is proven. The *match validity* half ("valid match") is a backend concept and is not exercised. |
| ST18 (fuzz) | The E2E proves conservation on one deterministic run and its ledger. The fuzz arm lives in `contracts/test/TestnetPoolEscrow.invariants.t.sol` and was not run as part of this harness. |

Also out of scope and untouched: all CP01–CP15 and CH03–CH10, CH12 (browser,
backend and receipt-verification behaviour).

## Defects found and fixed (all script-side)

1. **`block_ts()` returned a stale timestamp — the real cause of the reported
   runtime failure.** `block_ts()` read `cast block latest --field timestamp`,
   i.e. the *last mined block*. anvil stamps each new block with
   `max(parent.timestamp + 1, wall clock)`, so after the chain sits idle the last
   block can be minutes old. A deadline computed as `latest + 30` then lands in
   the past relative to the timestamp the next block actually receives, and
   `createRoom` reverts `BadDeadlines()`.
   Confirmed by tracing the original failure transaction:
   `0xdd23c66d…` reverted with custom error `0x0201e564`, which is
   `BadDeadlines()`; its trace shows
   `createRoom(…, 3, 1e15, 1792831982, 1792832582)` against a block stamped
   `1792832995`. Fixed by making `block_ts()` return
   `max(lastBlockTimestamp + 1, now)`, the timestamp the next block will carry.

   This is *not* a bash parse error and not a quoting problem in `sel`/`chk`:
   `bash -n` passes and the failing construct was a contract-side revert. The
   brief's "syntax error near unexpected token '('" was not reproducible on this
   tree; the only real error at that stage of the script is the one above.

2. **`run_tx` had no argument validation (hardening, not a live defect).** I
   initially suspected the call sites passed `<label> <pk> <to> ok ...`, but that
   was wrong: `git show HEAD:scripts/e2e-escrow.sh` confirms every call site was
   in the documented `<label> <pk> <ok|revert> <to> ...` order. The
   `invalid value 'ok' for '[TO]'` error I reproduced came from my own ad-hoc
   probe command, not from this tree. A guard was still added so a future
   mis-ordered call fails loudly instead of sending to a bogus address; it did
   not change the harness's behaviour.

3. **ST08 helper is single-use.** `dev-chain.sh` deploys `RejectingDepositor`
   once and records it in `.local-chain.env`; ST08 calls `disarm()`, which is
   permanent. On an idempotent chain reuse the recorded helper no longer rejects
   and the "payout must revert" assertion failed for the wrong reason. Fixed by
   verifying `rejecting()` on chain and deploying a fresh helper when needed,
   recorded in `scripts/.local-chain/<chain>/rejecting-helper.env` — never in
   `contracts/broadcast/`, which mixes local and testnet runs on chainId 10143.
4. **CRLF leaked into cast arguments.** On Windows, `jq -r` emits CRLF, so
   `rooms.json` and `getRoomDepositors` output carried a trailing `\r` into room
   keys and addresses, making cast fail with `parser error`. Fixed in
   `check-balance-conservation.sh` (`tr -d '\r'` on the room list) and in
   `depositors_of` in `lib/common.sh`.
5. **Conservation script never mapped the env schema.** It used
   `$HOST_ADDRESS`/`$PLAYER2_ADDRESS`/`$PLAYER3_ADDRESS`, which
   `.local-chain.env` never defines (it defines `P1_/P2_/P3_`), so `set -u`
   killed it at C3. Added the same mapping the E2E uses.
6. **Conservation ignored the ST08 helper's money.** The helper is a contract
   that receives a pot; without it in the wallet set C4 was off by exactly one
   pot. It is now in both snapshots and in the C3/C4 account set, addressed from
   the snapshot (not the env file, which can point at a different instance).
7. **Race transactions logged a fake sender.** The two step-22 transactions were
   appended to `txlog.jsonl` with `from:"-"`, hiding their gas from the
   conservation ledger. They now record their real senders.

Balance assertions were already delta-based (`ESCROW_BASE` at the start of the
run). That was verified rather than assumed: see below.

## Dirty-chain behaviour (defect 1)

`dev-chain.sh` is idempotent, so a rerun reuses a chain that may still hold funds
from an earlier aborted run. The harness measures `ESCROW_BASE` once and asserts
every contract-balance change as a delta from it. Verified on a chain carrying
`8000000000000000 wei` of leftover escrow from my own earlier probe transactions:

```
  contract balance at start: 8000000000000000 wei (baseline for all deltas)
  ...
  PASS  contract balance delta is zero (0 wei)
  ...
steps run     24
steps failed  0
  PASS  ALL 24 STEPS PASSED
```

That run passed with **no** change to the assertions, which is the actual proof
that the deltas — not absolute zeros — are what is being checked.

`A_CREATE_TX`'s receipt is also inspected, so a chain whose events look right but
whose state does not would still fail.

## Raw tail of the successful run

From `scripts/.local-chain/chain-127_0_0_1_8545/logs/e2e-blockts.log`
(the run made after the `block_ts()` fix). Path A payout and the whole of Path B:

```
[5] A4 — settle from the SETTLER key, naming a real depositor (player2)
  PASS  settle mined by 0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0 (tx 0x5028f937fcaf95e7c177824ea7fcbf02bc79b1d738c11f25dc98972ffb7b5e2e)
  PASS  status is SETTLED (3) (3)
  PASS  winner recorded is player2 (0xf3f50213c1d2e255e4b2bad430f8a38eef8d718e)
  PASS  resultHash stored verbatim (0x359c0324598befc3e851ba2e0d07bd7a2d765b5d528f34510ea7bdcb2891ebd3)
  PASS  prizePaid is still false — settle never transfers (false)
  PASS  contract balance delta == the pot (3000000000000000 wei)
  PASS  MatchSettled emitted exactly once (1)

[6] A5 — payout() triggered by a THIRD PARTY; funds must land on the recorded winner
  PASS  payout mined by 0xA40cFBFc8534FFC84E20a7d8bBC3729B26a35F6f (tx 0x2dca5b00589c4176e0f0cba920ca3dba3542c1ac0815b52c55427a32b45b9ce9)
  PASS  prizePaid is now true (true)
  PASS  player2 received the full pot (3000000000000000 wei)
  PASS  the caller received no prize (their balance only fell, by gas) (true)
  PASS  contract paid out exactly the pot (3000000000000000 wei)
  PASS  contract balance delta is zero (0 wei)
  PASS  PrizePaid names player2 as the recipient (1)

[7] B1 — second room, 3/3 funded, deliberately never settled
  PASS  roomB created (tx 0x9b3d1bfa3f2895787b9b53dba310d52af13ea9b870c7dbb79adaad27cf70b39e)
  PASS  player2 joined roomB (tx 0x530f7c2d0ef28085f4c8f42fffee1942852278284324bb5f993245b8235e6c51)
  PASS  player3 joined roomB (tx 0xe740959fa173eee2342cc867028d0470824eb1dea0dddbc4defb3794483d2a7e)
  PASS  roomB is FUNDED status (2)
  PASS  roomB's pot is on chain (3000000000000000 wei)

[8] B2 — warp past resolutionDeadline, then expireUnresolved from a NON-depositor
             (permissionless: no backend, no settler, no admin involved)
  PASS  expireUnresolved before the deadline — reverts 0x2eb35430
  PASS  roomB is still FUNDED after the early attempt status (2)
  warping 116s past resolutionDeadline 1792835883
  PASS  expireUnresolved mined by outsider 0xA40cFBFc8534FFC84E20a7d8bBC3729B26a35F6f (tx 0x7f4eeac8f03473ee8ed7a49075f6894f044831d6c76cf75e35d3a422003d5e27)
  PASS  status is CANCELED (4) status (4)
  PASS  cancelReason decodes to RESOLUTION_TIMEOUT (RESOLUTION_TIMEOUT)

[9] B3 — withdrawRefund for each of the three depositors, exact stake each
  PASS  HOST withdrew (tx 0x2f5f4a2a19333c93c4863d6fcfd247bc562ddca38c0d09e864302e695b1a9fa0)
  PASS  HOST net = +stake - own gas (1000000000000000 wei)
  PASS  HOST is flagged refundWithdrawn (true)
  PASS  PLAYER2 withdrew (tx 0x695a6e2cab15a17c322431cc2a2c9ed63365fe67d1e457555715063ea67bbb8f)
  PASS  PLAYER2 net = +stake - own gas (1000000000000000 wei)
  PASS  PLAYER2 is flagged refundWithdrawn (true)
  PASS  PLAYER3 withdrew (tx 0x0c9e603cecfca6357a496a09ccc31d43c718c9469f0021890bb395ca93a855bb)
  PASS  PLAYER3 net = +stake - own gas (1000000000000000 wei)
  PASS  PLAYER3 is flagged refundWithdrawn (true)
  PASS  contract balance delta back to zero after refunds (0 wei)
  PASS  roomB remains CANCELED status (4)
```

Head of the same run, showing the dirty-chain baseline:

```
  contract balance at start: 8000000000000000 wei (baseline for all deltas)
  ...
```

Footer:

```
steps run     24
steps failed  0
transactions  62 (all real, all mined)
------------------------------------------------------------
  PASS  ALL 24 STEPS PASSED
------------------------------------------------------------

Next: scripts/check-balance-conservation.sh
```

Conservation, same chain, same run:

```
[2] C2 — every room is terminal and its pot is fully accounted for
  ... (roomA..roomN, each PASS)

[4] C4 — sum of all wallet deltas plus gas paid is exactly zero (no money escaped)
  host  delta=+4000000017087920  gas=17087920  (delta+gas=-4000000000000000)
  player2  delta=+1000000007171864  gas=7171864  (delta+gas=-1000000000000000)
  player3  delta=+2999999993854296  gas=6145704  (delta+gas=3000000000000000)
  third_party  delta=+1000000005313392  gas=5313392  (delta+gas=-1000000000000000)
  settler  delta=+4182096  gas=4182096  (delta+gas=0)
  admin  delta=+860736  gas=860736  (delta+gas=0)
  rejecting_helper  delta=+3000000000000000  gas=0  (delta+gas=3000000000000000)
  PASS  sum over all wallets of (net delta + gas) is zero (0 wei)
------------------------------------------------------------

CONSERVATION RESULT
------------------------------------------------------------
checks failed  0
------------------------------------------------------------
  PASS  NO FUNDS STUCK — the escrow is fully drained and every wei is accounted for
------------------------------------------------------------
```

## Facts about this particular run

- The chain was **not** restarted (`dev-chain.sh --restart` was not permitted in
  this session). The harness ran against a chain already carrying
  `8000000000000000 wei` of leftover escrow from earlier probe transactions, so
  every run in this session is a dirty-chain run by construction. This is the
  stronger case for defect 1, not a weaker one.
- No contract bug was found. Every revert that the harness expected was returned
  with the exact custom-error selector.

## Known limitation left in place

`scripts/dev-chain.sh` still reads
`contracts/broadcast/Deploy.s.sol/10143/run-latest.json` to learn the escrow
address after `forge script --broadcast`. Because anvil shares chainId 10143 with
the real testnet, that directory mixes local and testnet runs, and
`run-latest.json` is overwritten by any run on that chainId. This is the
"unambiguous address" issue called out in the brief, and it is **not fixed
here**: `dev-chain.sh` was outside what could be safely rewritten in the time
budget, and it is currently correct only because it reads the broadcast file
immediately after its own deploy in the same process. If a testnet deploy lands
on the same machine between those two steps, the recorded `ESCROW_ADDRESS` can
be a testnet address. The fix is to have `forge script` emit the address directly
(via a `console2.log` or a JSON artifact written from inside `Deploy.s.sol`) and
never read `run-latest.json`; that requires touching `contracts/`, which is out
of scope for this task.

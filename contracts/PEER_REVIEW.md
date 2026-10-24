# Peer review checklist — TestnetPoolEscrow

Required by `AUDIT_CHECKLIST.md:24`: *"One developer other than contract author
reviews every withdrawal/settlement path."* This document exists so the reviewer
checks the dangerous paths rather than reading 400 lines from scratch.

**Reviewer:** ____________________ **Date:** __________
**Commit reviewed:** ________ **Address (if deployed):** ________

Do not sign off if any item in **§Gate** is unchecked. Signing is a statement that
you read the code, not that the contract is audited.

---

## §Gate — stop-ship items

These are the only items where a mistake loses funds. Everything else is secondary.

- [ ] **G1** `payout` sets `prizePaid = true` *before* the external `call`. Confirm by reading the function top to bottom, not by trusting the test.
- [ ] **G2** `withdrawRefund` sets `refundWithdrawn[...] = true` *before* the external `call`.
- [ ] **G3** Both functions are `nonReentrant`, and the guard is from OpenZeppelin 5.x, not hand-rolled.
- [ ] **G4** A failed transfer **reverts the whole call**. There is no `try/catch` swallowing it, and no path where `prizePaid` stays `true` after a failed send. (If `prizePaid` were set and the call failed silently, the prize would be permanently unclaimable.)
- [ ] **G5** `settle` requires `deposited[roomKey][winner] == true`. There is no way to name `address(0)`, an arbitrary address, or a non-participant.
- [ ] **G6** `SETTLED` and `CANCELED` are mutually exclusive: no function transitions out of either state. Check every state-writing function.
- [ ] **G7** `potWei` is recomputed as `entryWei * depositCount`, never accumulated from `msg.value`. Confirm an unsolicited native transfer cannot inflate a prize.
- [ ] **G8** `expireUnresolved` and `expireUnfunded` are callable by **anyone** — they must not carry `onlyRole`. This is the only guarantee that a dead backend cannot lock funds.

---

## §1 — Funding paths

### `createRoom`
- [ ] Rejects `roomKey == bytes32(0)` and any key already in use.
- [ ] Rejects `seats` outside 3–4.
- [ ] Rejects `entryWei` outside `[entryMinWei, entryMaxWei]`, and `entryWei == 0` is structurally impossible because `entryMinWei > 0` is enforced in the constructor.
- [ ] Rejects `msg.value != entryWei` — both underpay and overpay.
- [ ] Deadline checks reject: past funding deadline, `resolutionDeadline <= fundingDeadline`, and either window exceeding its cap. Result: a caller cannot park funds with a far-future deadline.
- [ ] Emits **both** `RoomCreated` and `DepositConfirmed(…, 1)`.
- [ ] Host is depositor index 0 in `getRoomDepositors`.
- [ ] `nonReentrant` present (defensive; no external call in this path).

### `joinRoom`
- [ ] Rejects a room not in `FUNDING` (so no join after `FUNDED`, `SETTLED`, `CANCELED`).
- [ ] Rejects after `fundingDeadline`.
- [ ] Rejects a wallet that already deposited, including the host.
- [ ] Rejects when `depositCount >= maxSeats`.
- [ ] Rejects `msg.value != entryWei`.
- [ ] Transitions to `FUNDED` **only** at exactly `maxSeats`, and emits `RoomFunded`. A 4-seat room with 3 deposits stays `FUNDING` — never silently starts short.

---

## §2 — Settlement

### `settle`
- [ ] `onlyRole(SETTLER_ROLE)`.
- [ ] Requires `status == FUNDED`; rejects `FUNDING`, `SETTLED`, `CANCELED`, `NONE`.
- [ ] Rejects after `resolutionDeadline`.
- [ ] Rejects `winner == address(0)` and `!deposited[roomKey][winner]`.
- [ ] Rejects `resultHash == bytes32(0)`.
- [ ] **Does not transfer value.** Settlement only records; the pot stays in the contract until `payout`. Confirm the balance is unchanged after `settle`.

### `payout`
- [ ] `nonReentrant`.
- [ ] Requires `status == SETTLED`; a `FUNDING`/`FUNDED`/`CANCELED` room reverts.
- [ ] Rejects a second call via `prizePaid`.
- [ ] Recipient is `room.winner`, read from storage — **not** `msg.sender`, **not** a parameter.
- [ ] Amount is `room.potWei`, not `address(this).balance`. A forced transfer must not be paid out.
- [ ] Callable by anyone (no role). Confirm `QA_CROSSPLAY.md:49` ST07: a third party triggering it still pays the winner.

---

## §3 — Cancellation and refunds

### `cancelRoom`
- [ ] `onlyRole(DEFAULT_ADMIN_ROLE)`. Confirm the settler **cannot** cancel — that separation is the reason two keys exist.
- [ ] Rejects `SETTLED` and `CANCELED`.
- [ ] Stores `cancelReason` in the struct, so the reason survives a restart without a log scan.

### `expireUnfunded` / `expireUnresolved`
- [ ] No role gate.
- [ ] `expireUnfunded` requires `FUNDING` **and** `block.timestamp > fundingDeadline`.
- [ ] `expireUnresolved` requires `FUNDED` **and** `block.timestamp > resolutionDeadline`.
- [ ] Neither can run early, and neither can run on a room that already reached a terminal state.
- [ ] A `FUNDED` room cannot be expired via `expireUnfunded` (wrong state), which is what stops someone griefing a live room's funding window.

### `withdrawRefund`
- [ ] `nonReentrant`.
- [ ] Requires `status == CANCELED`; `SETTLED` reverts.
- [ ] Requires `deposited[roomKey][msg.sender]` — not a parameter. Confirm a stranger cannot withdraw.
- [ ] Rejects a second withdrawal.
- [ ] Amount is `room.entryWei`, exactly one stake.
- [ ] Recipient is `msg.sender` only.

---

## §4 — Access control and deployment

- [ ] Constructor grants `DEFAULT_ADMIN_ROLE` to `admin` and `SETTLER_ROLE` to `settler`, both non-zero.
- [ ] Constructor rejects `admin == 0`, `settler == 0`, `entryMinWei == 0`, `entryMaxWei < entryMinWei`, `maxFundingWindowSec == 0`, `maxResolutionWindowSec <= maxFundingWindowSec`.
- [ ] There is **no** function that grants `SETTLER_ROLE` to a new address outside `DEFAULT_ADMIN_ROLE`. (If there is, note it: role-grant power on a hot key is a different risk profile.)
- [ ] `Deploy.s.sol` refuses `settler == admin` and refuses a chain other than 10143.
- [ ] No `selfdestruct`, no `delegatecall`, no upgrade proxy, no `receive()` that would accept unsolicited funds into a computable pot. (A plain `receive()` is acceptable only if it cannot affect `potWei` — confirm it cannot.)
- [ ] No owner-only sweep of the contract balance.

---

## §5 — Tests you must run yourself

Do not take the author's word for a green suite. Run:

```bash
cd contracts
forge test -vvv
```

- [ ] All unit tests pass.
- [ ] `forge test --match-contract TestnetPoolEscrowInvariantTest` passes; note the run and depth counts.
- [ ] The invariant handler actually calls every function. A handler with a dead selector proves nothing — check the call table in the output.
- [ ] Read `test_reentrancy_receiver_cannot_drain` and confirm the assertion is *"the re-entrant call fails and the prize is not consumed"*, not *"the transfer succeeded"*.
- [ ] Read `test_rejecting_receiver_does_not_consume_claim` and confirm it proves the claim survives a failed send.
- [ ] Read `test_forced_transfer_does_not_inflate_pot` and confirm a forced balance change cannot alter `potWei`.

---

## §6 — What this contract does NOT do

Reviewer should confirm the author is not overclaiming. These are documented
limitations, not defects, and they must appear in the README and the demo script.

- [ ] The winner is decided by the server. This is a trusted-oracle escrow; nothing here is provably fair.
- [ ] `resultHash` is opaque to the contract. It cannot recompute the hash or verify it matches the winner. The published preimage makes a mismatch *detectable off-chain*, not prevented.
- [ ] Room identity (`roomKey`) is supplied by the server. The contract cannot verify the `keccak256("BOMB_RUSH_V05", chainId, nonce, host)` derivation; it only enforces uniqueness and `msg.value`.
- [ ] A contract wallet that reverts on receive cannot be paid. The prize stays claimable and `payout` keeps reverting.
- [ ] Sybil resistance is out of scope: one wallet, one seat, but nothing stops one human with several wallets.
- [ ] No independent audit has been performed.

---

## Sign-off

- [ ] Every §Gate item checked and understood.
- [ ] Every §1–§4 item checked against the code, not against this checklist's wording.
- [ ] §5 commands actually run by the reviewer.
- [ ] §6 limitations confirmed present in `contracts/README.md`.

**Reviewer signature:** ____________________

**Findings** (file:line, severity, and whether it blocks deposits):

| # | Location | Severity | Blocks deposits? | Note |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

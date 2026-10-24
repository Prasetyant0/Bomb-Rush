# Testnet canary — verified on chain, 2026-10-24

Two complete rounds against the deployed `TestnetPoolEscrow` on Monad Testnet
(10143). Every hash below is a real transaction. Nothing here is simulated.

**Contract:** `0x8c839fab937a08177c2779eef36c15d8999be8fe`
**Deploy block:** 73756739
**Entry:** 0.001 MON per seat, 3 seats, pot 0.003 MON

---

## Path A — funded match, settled, paid out

| Step | Transaction |
|---|---|
| `createRoom` (host deposit) | `0xcd10d0defd6ff36b6f66153dfe0d5b4b4131ecfacb400c75e5f46e08d05db1b5` |
| `joinRoom` (deposit 2) | `0xe7bd7b0767b24aa8ee6393446647f4cf29b5fddaf2c5fec81145be5c104d15c4` |
| `joinRoom` (deposit 3) | `0x8966656857f05822e45ff2c88daf420280556a97ce1a21b5b0f6fb5f13a3d690` |
| `settle` by SETTLER_ROLE | `0xe6a02751ffa08f06bb581884a633a9aa2c18b1fc4be2caea196add437c202dbe` |
| `payout` by a THIRD party | `0xb01fe85961bd6d4f7899f4b0b91ff32b2d4aa2fbff7e40c82dedc2337e9027c5` |

State transitions observed: `FUNDING (1)` → `FUNDED (2)` at the third deposit →
`SETTLED (3)` after settle. `potWei` = 3e15 exactly.

**Balance evidence:**
- winner `0xAf83…ABf2`: 4.742188276 → **4.745188276 MON** (+0.003)
- escrow: 0.003 → **0**

The payout was triggered by the operator-bot key, not by the winner and not by
the settler. Funds still landed on the recorded winner. That is QA_CROSSPLAY
ST07.

`resultHash` settled: `0x738651623fde8d12c02d92022b38dd1a6be14a88b24f8053bde5cf0a90aae2d2`

---

## Path B — funded, never settled, refunded

| Step | Transaction |
|---|---|
| `createRoom` | `0x` (roomKey `0xf6c7ccc6…d33210`) |
| `joinRoom` ×2 | two deposits |
| `expireUnresolved` by a third party | `0xd4638bf75c304ddcf343f5dbdf163af5be991140b020dd81f15a68be25165053` |
| `withdrawRefund` ×3 | three separate withdrawals, all `status 1` |

State: `FUNDED (2)` → `CANCELED (4)` at the deadline, permissionlessly, by a
party with no role. Escrow balance after all three refunds: **0**.

**Double refund rejected:** a fourth `withdrawRefund` by an already-refunded
depositor reverts with `RefundAlreadyWithdrawn` (`0xfe37199e`).

---

## What these two rounds prove

- exact-value deposits, one seat per wallet, seats fill to exactly 3
- the pot is `entryWei × depositCount`, no fee, no forced-balance inflation
- settle is settler-only and happens once
- payout is permissionless in trigger, fixed in recipient
- a funded room with a dead game server is recoverable by anyone after the deadline
- each depositor gets exactly their stake back, once
- the contract balance always returns to zero: no funds stranded

## What they do NOT prove

- gameplay was not involved. The winner was chosen by hand, not by a match.
  The contract cannot verify a game result and does not claim to.
- the settlement is a trusted-oracle record. A dishonest settler could have
  named any depositor. Nothing on chain detects that.
- no browser was used. These were `cast` calls, so the frontend path
  (wallet connect → create → join) is still unexercised.
- roomKeys here were generated with `cast`, not by the frontend's
  `makeRoomKey`, though both use the same preimage.

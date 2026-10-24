# contracts — TestnetPoolEscrow

Native-MON **testnet** escrow for one BOMB RUSH 3D match. Each player deposits an
equal amount; the whole pot goes to the winner, or everyone is refunded.

**Monad Testnet, chainId 10143 only. Test MON has no monetary value.**

Spec: `docs/spec/SMART_CONTRACT_SPEC.md` (design) + `docs/spec/ESCROW_SECURITY.md`
(threat model) + `docs/spec/DECISIONS.md` (locked product decisions).

---

## What this contract does and does not do

It enforces exactly four things:

1. Only a real depositor of that room can be named winner.
2. The pot moves **once** — prize or refunds, never both, never twice.
3. Every depositor can recover their stake **without the backend**.
4. `potWei == entryWei * depositCount`, with **zero fee**.

It does **not** verify gameplay, does not make the game provably fair, and cannot
detect a dishonest settler. The winner is decided by the operator's server. This is
a **trusted-oracle escrow**, not trustless play. Never claim otherwise
(`docs/spec/PITCH_SCRIPT.md:31`, `README.md:60`).

---

## Layout

| Path | Purpose |
|---|---|
| `src/TestnetPoolEscrow.sol` | The contract. AccessControl + ReentrancyGuard. |
| `test/TestnetPoolEscrow.t.sol` | 46 tests: funding, settlement, payout, refunds, deadlines, reentrancy, fuzz conservation. |
| `script/Deploy.s.sol` | Chain-gated deploy. Refuses anything but 10143, refuses `settler == admin`. |

## Commands

```bash
cd contracts

# forge-std and OpenZeppelin are gitignored — reinstall after cloning.
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git

forge build
forge test -vvv
```

## Deploy

Two signers are required. The deploy key becomes `DEFAULT_ADMIN_ROLE` and should
stay cold; the server's hot key gets only `SETTLER_ROLE`.

```bash
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
PRIVATE_KEY=0x<deployer-key> \
SETTLER_ADDRESS=0x<server-signer-address> \
forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --broadcast
```

The script prints the deployment block. Record it — the backend needs it as
`ESCROW_DEPLOYMENT_BLOCK` to bound its log scan (`TRD.md:33`), and
`contracts/deployments/README.md` asks for it.

---

## Role model

| Role | Holder | Power |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | cold deployer wallet | `cancelRoom`, role grants |
| `SETTLER_ROLE` | server hot key (`SERVER_SETTLER_PRIVATE_KEY`) | `settle` |
| — | anyone | `payout`, `expireUnfunded`, `expireUnresolved` |
| — | each depositor | `withdrawRefund` (own stake only) |

Collapsing admin and settler into one key means a leaked server key can also grant
roles and cancel funded rooms. `Deploy.s.sol` refuses that configuration.

`payout` is permissionless by design: the recipient is fixed to the recorded
winner, so a third party triggering it cannot redirect funds (`MVP_SCOPE.md:12`,
`QA_CROSSPLAY.md:49` ST07). This is what keeps a funded room recoverable if the
relayer dies.

---

## Deviations from `SMART_CONTRACT_SPEC.md`

Each was decided with the design owner and is listed here so the spec can be
updated to match. Nothing here weakens a fund-safety invariant.

| # | Spec | Implemented | Why |
|---|---|---|---|
| 1 | Parameter named `roomId` (SPEC:30-41) | named `roomKey` | `API_CONTRACT.md:50-51` and `ERD.md:12,14` already have `roomId` (string PK) **and** `roomKey` (bytes32). One name, two values, was the highest-risk mixup. |
| 2 | `createRoom` emits only `RoomCreated` (SPEC:43-52) | also emits host `DepositConfirmed(roomKey, host, entryWei, 1)` | `API_CONTRACT.md:88` and `QA_CROSSPLAY.md:27` (CH01) require both events to confirm creation. |
| 3 | `cancelRoom` `onlyOperator`, role undefined (SPEC:35,79) | `DEFAULT_ADMIN_ROLE` | SPEC names only two roles. Adding a third key for a demo increases operational risk more than it reduces blast radius. |
| 4 | `Room` has no `cancelReason` field (SPEC:9-21) | field added, stored | The reason otherwise exists only in an event, so `GET /api/rooms/:code` cannot render `cancelReason` after a restart. |
| 5 | Entry bounds "configured by v0.5" (SPEC:68) | constructor args + `entryBounds()` getter | Backend must read the enforced range instead of hardcoding one that may diverge. |
| 6 | `getRoomDepositors` **or** `depositorAt` (SPEC:26 vs :41) | `getRoomDepositors`, deposit order, host at index 0 | One choice pinned so the TS decoder is stable. |

### Cancel reason encoding

`bytes32` is **right-padded ASCII** of the `CancelReason` string
(`API_CONTRACT.md:40-41`). The two protocol-generated reasons are emitted by the
contract itself: `FUNDING_TIMEOUT` and `RESOLUTION_TIMEOUT`. Operator cancels pass
`bytes32("OPERATOR_ABORT")`. `HOST_CANCELED` is unreachable on chain — the host has
no cancel power after funding (`DECISIONS.md:29`).

The `Room` struct stores the reason, so it is readable via `getRoom` without a log
scan.

---

## `resultHash` — what it proves, and what it does not

The contract stores an opaque `bytes32` and only proves it is non-zero. It **cannot**
recompute it: it never sees participant identifiers, `matchId`, or the off-chain
`roomId` string. Anyone who claims on-chain hash verification is wrong.

What makes it auditable is the **published preimage**, which binds the hash to both
the room and the winner:

```
resultHash = keccak256(abi.encode(
  "BOMB_RUSH_V05",
  roomKey,              // bytes32
  matchId,              // string
  sortedParticipantIds, // string[], lexicographic ascending
  winner,               // address
  resultVersion         // string, e.g. "0.5"
))
```

Because every input except the off-chain ids is public, an observer can recompute
the hash from a published match record and detect a mismatch between the settled
`winner` and the hash the server froze. That is **detectability, not prevention** —
the trusted settler still decides, and a mismatch is only provable after the fact.

The preimage must be implemented identically in `packages/shared` and the server.
This contract deliberately does not re-derive it.

---

## Known limitation — contract wallets

The prize goes to the immutable winning address. A smart-contract wallet with a
`receive()` that always reverts cannot be paid: `payout` reverts with
`TransferFailed`, the prize stays claimable, and it stays that way. P0 supports EOA
wallets only and must disclose this (`SMART_CONTRACT_SPEC.md:93-94`). This is also
what `test_rejecting_receiver_does_not_consume_claim` asserts.

---

## Test coverage

46 tests. Every case in `ESCROW_SECURITY.md:43` has an equivalent except
`rpc_missing_receipt_does_not_mark_confirmed`, which asserts backend behaviour and
cannot be expressed in Solidity.

Notable ones:

- `testFuzz_balance_conservation` — 256 runs over both terminal paths; every wei
  that enters leaves exactly once.
- `test_reentrancy_receiver_cannot_drain` — re-entry reverts, prize not consumed,
  pot recoverable on retry.
- `test_forced_transfer_does_not_inflate_pot` — unsolicited native transfers cannot
  change `potWei`.
- `test_roles_are_separated` — admin and settler are distinct keys.

This suite has **not** been independently audited. `AUDIT_CHECKLIST.md:24` requires
a second developer to review every withdrawal and settlement path before public
funding.

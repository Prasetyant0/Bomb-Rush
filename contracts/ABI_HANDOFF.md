# ABI handoff — TestnetPoolEscrow → backend

**For:** Dev B (server + `packages/shared`)
**From:** Dev C (contracts)
**Contract:** `contracts/src/TestnetPoolEscrow.sol`
**Chain:** Monad Testnet, `10143` only

Read `contracts/README.md` first for the trust model and the six deviations from
`SMART_CONTRACT_SPEC.md`. This file is the wiring reference: exact signatures,
selectors, encodings, and the values that must match between chain and server.

> **Status:** the merged backend on `main` is gameplay-only v0.3 (no `viem`, no chain
> module, `MONAD_RPC_URL` empty). Everything below is the surface it must grow into.
> Nothing here is wired yet.

---

## 1. Addresses and constants the server must read, not hardcode

| Value | Source | Why it cannot be hardcoded |
|---|---|---|
| `ESCROW_ADDRESS` | deploy output | changes per deployment |
| `ESCROW_DEPLOYMENT_BLOCK` | deploy output | bounds `eth_getLogs`; without it recovery either scans from genesis or misses deposits |
| `SETTLER_ROLE` holder | `hasRole` | must equal `SERVER_SETTLER_PRIVATE_KEY`'s address or every `settle` reverts |
| entry bounds | `entryBounds()` | contract enforces its own range; a hardcoded copy can diverge |
| `CHAIN_ID` | `eth_chainId` | reject any other chain before every write |

```ts
const [minWei, maxWei] = await client.readContract({
  address: ESCROW_ADDRESS, abi, functionName: 'entryBounds',
});
```

---

## 2. Functions

All `bytes32` room identifiers below are the protocol's **`roomKey`**, not the
server's string `roomId`. `API_CONTRACT.md` carries both; passing the string one is
the single easiest integration bug to make.

### Writes

| Function | Signature | Who calls | Emits |
|---|---|---|---|
| `createRoom` | `createRoom(bytes32 roomKey, uint8 seats, uint256 entryWei, uint64 fundingDeadline, uint64 resolutionDeadline)` **payable**, `msg.value == entryWei` | host wallet (frontend) | `RoomCreated` + `DepositConfirmed(host, entryWei, 1)` |
| `joinRoom` | `joinRoom(bytes32 roomKey)` **payable**, exact value | player wallet (frontend) | `DepositConfirmed`; `RoomFunded` when the last seat fills |
| `settle` | `settle(bytes32 roomKey, address winner, bytes32 resultHash)` | server signer (`SETTLER_ROLE`) | `MatchSettled` |
| `payout` | `payout(bytes32 roomKey)` | server relayer **or anyone** | `PrizePaid` |
| `cancelRoom` | `cancelRoom(bytes32 roomKey, bytes32 reason)` | admin key only | `RoomCanceled` |
| `expireUnfunded` | `expireUnfunded(bytes32 roomKey)` | **anyone** | `RoomCanceled` |
| `expireUnresolved` | `expireUnresolved(bytes32 roomKey)` | **anyone** | `RoomCanceled` |
| `withdrawRefund` | `withdrawRefund(bytes32 roomKey)` | each depositor, own stake | `RefundWithdrawn` |

Deadlines are **UNIX seconds** (`uint64`), while the API carries `*_Ms`. Convert at
the boundary, in one place. `fundingDeadline` must be `> block.timestamp` and
`<= now + maxFundingWindowSec()`; `resolutionDeadline` must be `> fundingDeadline`
and `<= now + maxResolutionWindowSec()`. The contract rejects anything else, so a
server bug here surfaces as a reverting `createRoom` rather than a parked deposit.

### Reads

| Function | Returns | Use |
|---|---|---|
| `getRoom(bytes32) → Room` | 12-field struct, order below | `RoomPublicState` projection, recovery page |
| `hasDeposited(bytes32, address) → bool` | membership | receipt verification, "am I in this room" |
| `refundWithdrawn(bytes32, address) → bool` | public mapping | "already claimed" badge |
| `getRoomDepositors(bytes32) → address[]` | deposit order, host at index 0 | lobby seats, winner eligibility display |
| `entryBounds() → (uint256 min, uint256 max)` | enforced range | validate UI input against the chain |
| `hasRole(bytes32, address) → bool` | role check | server startup self-check |
| `SETTLER_ROLE() → bytes32` | constant | compute at startup instead of hashing a string |
| `maxFundingWindowSec()`, `maxResolutionWindowSec() → uint64` | caps | clamp server deadlines before sending |

### `Room` struct — field order is part of the ABI

```solidity
struct Room {
    address host;                 // 0
    uint8   maxSeats;             // 1  (3 or 4)
    uint8   depositCount;         // 2
    uint256 entryWei;             // 3
    uint256 potWei;               // 4  == entryWei * depositCount
    uint64  fundingDeadline;      // 5  seconds
    uint64  resolutionDeadline;   // 6  seconds
    EscrowStatus status;          // 7  uint8
    address winner;               // 8
    bytes32 resultHash;           // 9
    bytes32 cancelReason;         // 10  (added; not in SMART_CONTRACT_SPEC)
    bool    prizePaid;            // 11
}
```

`EscrowStatus` ordinals — pin these in the TS decoder:

| Ordinal | Name |
|---|---|
| 0 | `NONE` (room does not exist) |
| 1 | `FUNDING` |
| 2 | `FUNDED` |
| 3 | `SETTLED` |
| 4 | `CANCELED` |

---

## 3. Events — receipt verification

Topic layout matters. Both indexed fields are topics; everything else is data.

| Event | Signature | Indexed |
|---|---|---|
| `RoomCreated` | `RoomCreated(bytes32 roomKey, address host, uint256 entryWei, uint8 maxSeats, uint64 fundingDeadline, uint64 resolutionDeadline)` | `roomKey`, `host` |
| `DepositConfirmed` | `DepositConfirmed(bytes32 roomKey, address player, uint256 amountWei, uint8 count)` | `roomKey`, `player` |
| `RoomFunded` | `RoomFunded(bytes32 roomKey, uint256 potWei)` | `roomKey` |
| `MatchSettled` | `MatchSettled(bytes32 roomKey, address winner, uint256 prizeWei, bytes32 resultHash)` | `roomKey`, `winner` |
| `PrizePaid` | `PrizePaid(bytes32 roomKey, address winner, uint256 amountWei)` | `roomKey`, `winner` |
| `RoomCanceled` | `RoomCanceled(bytes32 roomKey, bytes32 reason)` | `roomKey` |
| `RefundWithdrawn` | `RefundWithdrawn(bytes32 roomKey, address player, uint256 amountWei)` | `roomKey`, `player` |

**`createRoom` emits `DepositConfirmed` for the host.** The create-confirm endpoint
in `API_CONTRACT.md:88` and CH01 in `QA_CROSSPLAY.md:27` verify both events; the
spec's event list never assigned `DepositConfirmed` to `createRoom`, so this is a
deliberate addition. Verify both, or verify `RoomCreated` plus
`getRoom(...).depositCount == 1` — but do not assume only one event fires.

For every deposit, verify **all** of: `receipt.status == success`, `chainId == 10143`,
`log.address == ESCROW_ADDRESS`, `roomKey` matches the room you handed out,
`player` matches the session-bound wallet, and `amountWei == entryWei`. A tx hash
alone is not proof (threat matrix row 3).

Dedupe by `(txHash, logIndex)` (ERD §"Dedupe"). Reconnects resend logs.

---

## 4. `cancelReason` encoding

`bytes32`, **right-padded ASCII** of the `CancelReason` string.

```ts
import { stringToHex, padHex } from 'viem';
const reason = padHex(stringToHex('OPERATOR_ABORT'), { size: 32 }); // 0x4f5045...0000
```

Decoding back:

```ts
import { hexToString } from 'viem';
hexToString(reason as `0x${string}`, { size: 32 }).replace(/\0+$/, '');
```

The two protocol-generated reasons are emitted by the contract itself:

| Situation | Reason bytes32 |
|---|---|
| funding window closed, seats unfilled | `FUNDING_TIMEOUT` |
| funded but never settled before the resolution deadline | `RESOLUTION_TIMEOUT` |
| operator cancel | whatever the caller passes; use `OPERATOR_ABORT` |

`HOST_CANCELED` is **unreachable** — the host has no cancel power after funding
(`DECISIONS.md:29`). Do not write a branch for it.

The reason is also stored in `Room.cancelReason`, so `GET /api/rooms/:code` can
render it after a restart without a log scan.

---

## 5. `resultHash` preimage

The contract stores it as an opaque `bytes32` and only checks `!= 0`. It cannot
recompute it. **The server and `packages/shared` must produce it identically**, or
no observer can audit a settlement.

```
resultHash = keccak256(abi.encode(
  "BOMB_RUSH_V05",       // string, protocol tag
  roomKey,               // bytes32
  matchId,               // string
  sortedParticipantIds,  // string[], lexicographic ascending
  winner,                // address
  resultVersion          // string, "0.5"
))
```

```ts
import { encodeAbiParameters, keccak256 } from 'viem';

export function resultHash(i: {
  roomKey: `0x${string}`;
  matchId: string;
  participantIds: string[];
  winner: `0x${string}`;
}): `0x${string}` {
  const sorted = [...i.participantIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'string' }, { type: 'bytes32' }, { type: 'string' },
        { type: 'string[]' }, { type: 'address' }, { type: 'string' },
      ],
      ['BOMB_RUSH_V05', i.roomKey, i.matchId, sorted, i.winner, '0.5'],
    ),
  );
}
```

**Why `roomKey` and `winner` are inside the preimage:** they are public. An observer
who has the match record can recompute the hash and detect a settlement where the
recorded winner does not match the frozen record. That is *detectability*, not
prevention — the trusted settler still decides. Never describe it as on-chain
verification.

Participants are sorted **lexicographically ascending**, not by join order or seat.
Join order differs between runs; sort order must not.

---

## 6. Custom errors — map to REST / socket error codes

The server sees a revert with no reason unless it maps the selector.

| Error | Meaning | Suggested API code |
|---|---|---|
| `RoomExists` | key already used | `ROOM_EXISTS` |
| `RoomMissing` | no such key | `ROOM_NOT_FOUND` |
| `BadSeats` | seats outside 3–4 | `BAD_REQUEST` |
| `BadEntry` | entry outside bounds / zero | `INVALID_ENTRY_WEI` |
| `BadDeadlines` | past, inverted, or beyond cap | `BAD_REQUEST` |
| `RoomNotFunding` | join after funding closed | `ROOM_FULL` / `LOBBY_LOCKED` |
| `DeadlinePassed` | funding or resolution window closed | `ROOM_EXPIRED` |
| `DeadlineNotPassed` | expire attempted too early | `BAD_STATE` |
| `WrongValue` | `msg.value != entryWei` | `INVALID_ENTRY_WEI` |
| `AlreadyDeposited` | wallet already funded this room | `ALREADY_FUNDED` |
| `RoomFull` | seats taken | `ROOM_FULL` |
| `NotFunded` | settle before FUNDED | `BAD_STATE` |
| `WinnerNotDepositor` | winner not in this room | `TX_REVERTED` |
| `ZeroWinner` / `ZeroResultHash` / `ZeroRoomKey` | malformed input | `BAD_REQUEST` |
| `AlreadySettled` | second settle | `TX_REVERTED` |
| `AlreadyCanceled` | terminal | `MATCH_CANCELED` |
| `NotCancelable` | wrong state for cancel/expire/refund | `REFUND_NOT_AVAILABLE` |
| `PrizeAlreadyPaid` | second payout | `TX_REVERTED` |
| `NotDepositor` | refund by a stranger | `NOT_AUTHORIZED` |
| `RefundAlreadyWithdrawn` | second refund | `TX_REVERTED` |
| `TransferFailed` | recipient rejected MON | `TX_REVERTED` |

Access-control reverts surface as OpenZeppelin `AccessControlUnauthorizedAccount`,
not a custom error. Map that to `NOT_AUTHORIZED`.

---

## 7. Status projection — `escrowStatus` → `SettlementView`

The game state and the chain state are independent (`DECISIONS.md:12`). Do not
collapse them.

| `EscrowStatus` | `prizePaid` | `SettlementView` |
|---|---|---|
| `FUNDING` | false | `NONE` |
| `FUNDED` | false | `NONE` |
| `SETTLED` | false | `CLAIMABLE` |
| `SETTLED` | true | `PAID` |
| `CANCELED` | false, any refund outstanding | `REFUNDABLE` |
| `CANCELED` | false, all refunded | `REFUNDED` |
| `NONE` | — | `NONE` |

**`FAILED` has no on-chain representation.** A failed `payout` leaves
`SETTLED && !prizePaid` — byte-identical to "never attempted". After a backend
restart a failed payout reads back as `CLAIMABLE`. That is correct and honest
(the funds really are claimable), but it means `FAILED` is server-memory-only and
must not be persisted as a chain-derived fact. Either accept the reset or add a
payout-attempt counter; the spec chose neither, so document whichever you pick.

---

## 8. What the server must never do

- Trust a client-supplied `winner`, `funded`, `potWei`, `depositCount`, or tx hash as authorization. Read the chain.
- Mark a deposit `FUNDED` from a pending or unconfirmed receipt.
- Call `settle` for a room whose on-chain `depositCount != maxSeats`.
- Call `settle` with a winner that is not in `getRoomDepositors`. The contract reverts, but the revert at demo time is worse than the check.
- Hardcode the entry bounds instead of reading `entryBounds()`.
- Assume `createRoom` emits only one event.
- Claim the settlement is verifiable on chain beyond "a settlement was recorded".

---

## 9. Minimum backend chain module

```ts
// apps/server/src/chain/escrow.ts
// - createPublicClient (chain 10143) + createWalletClient (SETTLER_ROLE key)
// - watchContractEvent RoomCreated | DepositConfirmed | RoomFunded |
//   MatchSettled | PrizePaid | RoomCanceled | RefundWithdrawn, from ESCROW_DEPLOYMENT_BLOCK
// - verifyReceipt(txHash, expected) -> { ok, reason }   // all five checks in §3
// - recordSettlement(roomKey, winner, resultHash) -> settle + confirm + emit
// - triggerPayout(roomKey) -> payout + confirm + emit
// - reconcileOnStartup() -> eth_getLogs from ESCROW_DEPLOYMENT_BLOCK, rebuild store
```

Startup self-check, before serving traffic:

```ts
assert(await chainId() === 10143);
assert(await hasDeposited !== undefined);                  // code exists
assert(await read.hasRole(SETTLER_ROLE, settlerAddress));  // we can settle
assert(adminAddress !== settlerAddress);                   // keys separated
assert(entryBounds() matches packages/shared);
```

Anything false means funded rooms will fail at demo time. Fail loudly at boot
instead.

---

## 10. Open items for Dev B

1. `roomKey` in `RoomPublicState` is `bytes32`; the contract parameter is now named `roomKey` too. Confirm no call site passes `roomId`.
2. `serverNonce` in the `roomKey` derivation has **no type** in `API_CONTRACT.md:101`. `abi.encodePacked` output depends on it (`uint64` = 8 bytes, `uint256` = 32). Pin it before two honest implementations diverge.
3. `GET /api/escrow/:roomKey` returns one `deadlineMs`; the room has two. The client cannot tell whether `expireUnfunded` or `expireUnresolved` is legal. Needs both deadlines plus `hasDeposited` / `refundWithdrawn` per wallet.
4. `packages/shared` on `main` is v0.3 (`PROTOCOL_VERSION = '0.3'`, `SNAPSHOT_HZ = 10`, `ARENA_RADIUS = 10`, `RECONNECT_GRACE_MS = 3000`). v0.5 requires `ARENA_RADIUS = 7`, `SNAPSHOT_HZ = 15`, `RECONNECT_GRACE_MS = 5000`, plus `ENTRY_*_WEI`, `FUNDING_WINDOW_SEC`, `RESOLUTION_WINDOW_SEC`. The `resultHash` helper does not exist yet.

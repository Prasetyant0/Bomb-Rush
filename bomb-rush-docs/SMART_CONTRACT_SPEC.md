# SMART_CONTRACT_SPEC — TestnetPoolEscrow v0.5 (DESIGN ONLY)

**Chain:** Monad Testnet chain ID 10143; native MON. **Contract is not present, compiled, audited or deployed in this pack.** Implement, test, and peer-review before permitting any test MON deposit. NO mainnet.

## Data structures / public state
```solidity
// Pseudocode ABI, NOT copy-paste-safe deployable Solidity.
enum EscrowStatus { NONE, FUNDING, FUNDED, SETTLED, CANCELED }
struct Room {
  address host;
  uint8 maxSeats;             // 3 or 4, also exact funded player requirement
  uint8 depositCount;
  uint256 entryWei;           // immutable exact amount per player
  uint256 potWei;             // derived from entryWei * depositCount
  uint64 fundingDeadline;    // UNIX seconds
  uint64 resolutionDeadline; // UNIX seconds, > fundingDeadline
  EscrowStatus status;
  address winner;
  bytes32 resultHash;
  bool prizePaid;
}
mapping(bytes32 => Room) public rooms;
mapping(bytes32 => mapping(address => bool)) public deposited;
mapping(bytes32 => mapping(address => bool)) public refundWithdrawn;
```
`Room` getter alone does not enumerate depositors; emit indexed events and expose `getRoomDepositors` for ≤4 wallets or `depositorAt(roomId, index)`. Runtime and frontend must verify membership through state reads, not trust a submitted list.

## API (design-level function and event contract)
```solidity
function createRoom(bytes32 roomId, uint8 seats, uint256 entryWei,
                    uint64 fundingDeadline, uint64 resolutionDeadline) external payable;
function joinRoom(bytes32 roomId) external payable;
function settle(bytes32 roomId, address winner, bytes32 resultHash) external onlySettler;
function payout(bytes32 roomId) external nonReentrant;
function cancelRoom(bytes32 roomId, bytes32 reason) external onlyOperator;
function expireUnfunded(bytes32 roomId) external;
function expireUnresolved(bytes32 roomId) external;
function withdrawRefund(bytes32 roomId) external nonReentrant;
function getRoom(bytes32 roomId) external view returns (Room memory);
function hasDeposited(bytes32 roomId, address player) external view returns (bool);
function getRoomDepositors(bytes32 roomId) external view returns (address[] memory);

event RoomCreated(bytes32 indexed roomId, address indexed host,
                  uint256 entryWei, uint8 maxSeats, uint64 fundingDeadline, uint64 resolutionDeadline);
event DepositConfirmed(bytes32 indexed roomId, address indexed player, uint256 amountWei, uint8 count);
event RoomFunded(bytes32 indexed roomId, uint256 potWei);
event MatchSettled(bytes32 indexed roomId, address indexed winner, uint256 prizeWei, bytes32 resultHash);
event PrizePaid(bytes32 indexed roomId, address indexed winner, uint256 amountWei);
event RoomCanceled(bytes32 indexed roomId, bytes32 reason);
event RefundWithdrawn(bytes32 indexed roomId, address indexed player, uint256 amountWei);
```
The above **five-argument** `createRoom` signature is canonical. `entryWei` is immutable after creation, `msg.value == entryWei` is required, and the host is counted as the first depositor. Never introduce a conflicting overload.

## State transitions & guards
| From | Caller/action | Preconditions | To / effect |
|---|---|---|---|
| NONE | `createRoom` | unique ID; seats 3–4; exact entry; deadline bounds; msg.value==entry | FUNDING, count=1, pot=entry |
| FUNDING | `joinRoom` | before fundingDeadline, wallet not deposited, count<seats, msg.value==entry | FUNDING +1; at exact seats → FUNDED |
| FUNDED | `settle` | onlySettler, before resolutionDeadline, valid depositor winner, resultHash != 0, not canceled | SETTLED; prize claimable once |
| SETTLED | `payout` | !prizePaid | SETTLED; `prizePaid=true`; pay **recorded winner only** |
| FUNDING/FUNDED | `cancelRoom` | authorized operator, not SETTLED | CANCELED, pull refunds enabled |
| FUNDING | `expireUnfunded` | block.timestamp > fundingDeadline | CANCELED |
| FUNDED | `expireUnresolved` | block.timestamp > resolutionDeadline | CANCELED |
| CANCELED | `withdrawRefund` | sender deposited, !refundWithdrawn | CANCELED, send exact entry to sender |

## Invariants (hard asserts)
1. Same address deposits at most once per room; no duplicate seat or deposit.
2. Exact `msg.value` only. `entryWei > 0`, within canonical minimum/maximum configured by v0.5; host decides before creation, immutable afterward.
3. `potWei == entryWei * depositCount` (count ∈ [1, maxSeats]). Ignore accidental forced ETH transfers when calculating pool; do not expose arbitrary treasury sweep in demo.
4. Settlement requires `status == FUNDED`, `winner != address(0)`, `deposited[roomId][winner]` and a result hash. No duplicate settlement.
5. A canceled room can never settle or payout; settled room can never cancel or refund.
6. Each depositor gets **exactly one** refund on canceled room, with state updated before external transfer.
7. Prize value is exact pot with **zero platform fee**. No other recipient receives funds; `prizePaid` set before calling winner.
8. Failed native transfer **reverts atomically**, leaving `prizePaid=false` or `refundWithdrawn=false`, so user can retry. Do not silently eat errors.
9. Deadlines check `block.timestamp` only (seconds). Cap maximum room lifetime; testnet 10-min funding/20-min resolution are product defaults but validate ranges at deploy.
10. Contract never accepts mainnet by magic: deploy only against explicitly checked 10143; frontend and operator verify `eth_chainId`.

## Key handling
- Role `DEFAULT_ADMIN_ROLE` held by deployer wallet, `SETTLER_ROLE` held by backend signer, separate permissions for cancellation as narrowly as possible. One funded room can be unfairly resolved by compromised settler: this is a **trusted oracle** model, not trustless fair play.
- Runtime private key only in server env/vault, never NEXT_PUBLIC/VITE_ env and never repo. Testnet dedicated signer with no mainnet funds.

## Winner flow and timing
1. Backend emits `match:finished` once and freezes resultHash (canonical deterministic encoding of roomId, matchId, participants, winner, result version).
2. Backend reconciles contract `FUNDED`, identical wallets and seats, then broadcasts pending and calls `settle` as authorized signer.
3. Await receipt; verify `MatchSettled`; show `CLAIMABLE` status.
4. the server relayer calls `payout(roomId)` automatically after confirming settlement, or anyone can invoke it as a fallback; it sends to recorded winner only; receipt verifies `PrizePaid` and wallet delta (minus gas if winner self-pays).
5. If RPC temporarily fails, **DO NOT** mark settled/paid. Retry after reading contract status to avoid double actions. After deadline, unresolved room can be expired and refunded.

## Recovery and accounting
- Contract persists even if game server restarts. On app reload use read-only `getRoom` and `hasDeposited`; on server recovery fetch logs from deployment block and rebuild mapping. Unfinished game after restart should **not invent a winner**; prefer operator cancellation or timed expiry/refunds.
- If `payout` transfer fails, settlement remains claimable and retryable indefinitely. Refunds remain withdrawable for canceled room; do not require live backend for them.

## Known recipient limitation
The native MON prize is paid to the immutable winning depositor. A smart-contract wallet that permanently rejects native transfers may be unable to receive its prize; `payout` will remain claimable but repeatedly revert. P0 funding UX supports ordinary EOA wallets only and must disclose that unsupported contract wallets may not be able to claim. This is not a production-grade recovery guarantee for every possible recipient; a later version could add a winner-authorized destination update with replay-protected signature and security review.

## Non-goals
Provably fair randomization, multi-chain bridging, ERC20 support, real-value use, fee distribution, batching or gas sponsorship.

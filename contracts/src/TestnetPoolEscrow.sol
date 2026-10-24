// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title TestnetPoolEscrow
/// @notice Holds an equal native-MON testnet stake per player for one BOMB RUSH 3D
///         match, and releases the whole pot to the winner or refunds everyone.
/// @dev MONAD TESTNET ONLY (chainId 10143). Test MON has no monetary value.
///
/// TRUST MODEL — read this before relying on anything here.
/// The winner is decided by the operator's authoritative game server. This
/// contract does **not** verify gameplay, does not make the game provably fair,
/// and cannot detect a dishonest settler. It enforces exactly four things:
///   1. only a real depositor of this room can be named winner,
///   2. the pot moves exactly once, either as a prize or as refunds, never both,
///   3. every depositor can always recover their stake without the backend,
///   4. the pot is exactly `entryWei * depositCount`, with no fee.
/// That is a trusted-oracle escrow, not trustless play. Never claim otherwise.
///
/// Scope authority: `docs/spec/SMART_CONTRACT_SPEC.md` (+ `ESCROW_SECURITY.md`).
/// Deviations from that specification, and the reasoning for each, are listed in
/// `contracts/README.md` §"Deviations from the spec".
contract TestnetPoolEscrow is AccessControl, ReentrancyGuard {
    /// @dev NONE is unreachable for a stored room; a room exists only once created.
    enum EscrowStatus {
        NONE,
        FUNDING,
        FUNDED,
        SETTLED,
        CANCELED
    }

    struct Room {
        address host;
        uint8 maxSeats;
        uint8 depositCount;
        uint256 entryWei;
        uint256 potWei;
        uint64 fundingDeadline;
        uint64 resolutionDeadline;
        EscrowStatus status;
        address winner;
        bytes32 resultHash;
        bytes32 cancelReason;
        bool prizePaid;
    }

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    /// @notice Hard bounds for `entryWei`, fixed at deploy and readable by the backend
    ///         so it never hardcodes a range that diverged from the deployed contract.
    uint256 public immutable entryMinWei;
    uint256 public immutable entryMaxWei;

    /// @notice Lifetime caps. A caller-supplied deadline outside these is rejected,
    ///         which is what keeps `createRoom` from being used to park funds forever.
    uint64 public immutable maxFundingWindowSec;
    uint64 public immutable maxResolutionWindowSec;

    mapping(bytes32 => Room) internal _rooms;
    mapping(bytes32 => mapping(address => bool)) public deposited;
    mapping(bytes32 => mapping(address => bool)) public refundWithdrawn;
    mapping(bytes32 => address[]) internal _depositors;

    event RoomCreated(
        bytes32 indexed roomKey,
        address indexed host,
        uint256 entryWei,
        uint8 maxSeats,
        uint64 fundingDeadline,
        uint64 resolutionDeadline
    );
    event DepositConfirmed(
        bytes32 indexed roomKey, address indexed player, uint256 amountWei, uint8 count
    );
    event RoomFunded(bytes32 indexed roomKey, uint256 potWei);
    event MatchSettled(
        bytes32 indexed roomKey, address indexed winner, uint256 prizeWei, bytes32 resultHash
    );
    event PrizePaid(bytes32 indexed roomKey, address indexed winner, uint256 amountWei);
    event RoomCanceled(bytes32 indexed roomKey, bytes32 reason);
    event RefundWithdrawn(bytes32 indexed roomKey, address indexed player, uint256 amountWei);

    error NotSettler();
    error NotAdmin();
    error ZeroRoomKey();
    error RoomExists();
    error RoomMissing();
    error BadSeats();
    error BadEntry();
    error BadDeadlines();
    error RoomNotFunding();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error WrongValue();
    error AlreadyDeposited();
    error RoomFull();
    error NotFunded();
    error NotSettled();
    error WinnerNotDepositor();
    error ZeroWinner();
    error ZeroResultHash();
    error AlreadySettled();
    error AlreadyCanceled();
    error NotCancelable();
    error PrizeAlreadyPaid();
    error NotDepositor();
    error RefundAlreadyWithdrawn();
    error TransferFailed();

    constructor(
        address admin,
        address settler,
        uint256 entryMinWei_,
        uint256 entryMaxWei_,
        uint64 maxFundingWindowSec_,
        uint64 maxResolutionWindowSec_
    ) {
        if (admin == address(0) || settler == address(0)) revert BadEntry();
        if (entryMinWei_ == 0 || entryMaxWei_ < entryMinWei_) revert BadEntry();
        if (maxResolutionWindowSec_ <= maxFundingWindowSec_ || maxFundingWindowSec_ == 0) {
            revert BadDeadlines();
        }

        // Deployer holds the admin role; the hot server key holds only SETTLER_ROLE.
        // Keeping them separate is what stops a leaked server key from granting
        // roles or cancelling funded rooms. See ESCROW_SECURITY §"Key handling".
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, settler);

        entryMinWei = entryMinWei_;
        entryMaxWei = entryMaxWei_;
        maxFundingWindowSec = maxFundingWindowSec_;
        maxResolutionWindowSec = maxResolutionWindowSec_;
    }

    // ---------------------------------------------------------------- funding

    /// @notice Create a room and fund the host's own seat in one payment.
    /// @dev Emits both `RoomCreated` and a host `DepositConfirmed` (count = 1), because
    ///      the create-confirm flow in `API_CONTRACT.md` §3 verifies both events.
    function createRoom(
        bytes32 roomKey,
        uint8 seats,
        uint256 entryWei,
        uint64 fundingDeadline,
        uint64 resolutionDeadline
    ) external payable nonReentrant {
        if (roomKey == bytes32(0)) revert ZeroRoomKey();
        if (_rooms[roomKey].status != EscrowStatus.NONE) revert RoomExists();
        if (seats < 3 || seats > 4) revert BadSeats();
        if (entryWei < entryMinWei || entryWei > entryMaxWei) revert BadEntry();
        if (msg.value != entryWei) revert WrongValue();

        uint64 nowTs = uint64(block.timestamp);
        if (
            fundingDeadline <= nowTs || resolutionDeadline <= fundingDeadline
                || fundingDeadline > nowTs + maxFundingWindowSec
                || resolutionDeadline > nowTs + maxResolutionWindowSec
        ) revert BadDeadlines();

        _rooms[roomKey] = Room({
            host: msg.sender,
            maxSeats: seats,
            depositCount: 1,
            entryWei: entryWei,
            potWei: entryWei,
            fundingDeadline: fundingDeadline,
            resolutionDeadline: resolutionDeadline,
            status: EscrowStatus.FUNDING,
            winner: address(0),
            resultHash: bytes32(0),
            cancelReason: bytes32(0),
            prizePaid: false
        });

        deposited[roomKey][msg.sender] = true;
        _depositors[roomKey].push(msg.sender);

        emit RoomCreated(
            roomKey, msg.sender, entryWei, seats, fundingDeadline, resolutionDeadline
        );
        emit DepositConfirmed(roomKey, msg.sender, entryWei, 1);
    }

    /// @notice Fund one seat. Exact value only; one seat per wallet per room.
    function joinRoom(bytes32 roomKey) external payable nonReentrant {
        Room storage room = _rooms[roomKey];
        if (room.status == EscrowStatus.NONE) revert RoomMissing();
        if (room.status != EscrowStatus.FUNDING) revert RoomNotFunding();
        if (block.timestamp > room.fundingDeadline) revert DeadlinePassed();
        if (deposited[roomKey][msg.sender]) revert AlreadyDeposited();
        if (room.depositCount >= room.maxSeats) revert RoomFull();
        if (msg.value != room.entryWei) revert WrongValue();

        deposited[roomKey][msg.sender] = true;
        _depositors[roomKey].push(msg.sender);
        room.depositCount += 1;
        // potWei is derived, never accumulated from msg.value, so a forced transfer
        // into the contract can never inflate a prize.
        room.potWei = room.entryWei * room.depositCount;

        emit DepositConfirmed(roomKey, msg.sender, msg.value, room.depositCount);

        if (room.depositCount == room.maxSeats) {
            room.status = EscrowStatus.FUNDED;
            emit RoomFunded(roomKey, room.potWei);
        }
    }

    // -------------------------------------------------------------- settlement

    /// @notice Record the winner and make the pot claimable. Never transfers here.
    /// @param resultHash Opaque canonical hash. The contract only proves it is non-zero;
    ///        it cannot recompute it, because it never sees the participants' off-chain
    ///        identifiers. Bound to `roomKey` and `winner` by the published preimage, so
    ///        a mismatch is detectable off-chain from public data. See contracts/README.md.
    function settle(bytes32 roomKey, address winner, bytes32 resultHash)
        external
        onlyRole(SETTLER_ROLE)
    {
        Room storage room = _rooms[roomKey];
        if (room.status == EscrowStatus.NONE) revert RoomMissing();
        if (room.status == EscrowStatus.SETTLED) revert AlreadySettled();
        if (room.status == EscrowStatus.CANCELED) revert AlreadyCanceled();
        if (room.status != EscrowStatus.FUNDED) revert NotFunded();
        if (block.timestamp > room.resolutionDeadline) revert DeadlinePassed();
        if (winner == address(0)) revert ZeroWinner();
        if (!deposited[roomKey][winner]) revert WinnerNotDepositor();
        if (resultHash == bytes32(0)) revert ZeroResultHash();

        room.status = EscrowStatus.SETTLED;
        room.winner = winner;
        room.resultHash = resultHash;

        emit MatchSettled(roomKey, winner, room.potWei, resultHash);
    }

    /// @notice Send the pot to the recorded winner. Callable by anyone; the recipient
    ///         is fixed. A failed transfer reverts the whole call, leaving the prize
    ///         claimable rather than consumed.
    function payout(bytes32 roomKey) external nonReentrant {
        Room storage room = _rooms[roomKey];
        if (room.status != EscrowStatus.SETTLED) revert NotSettled();
        if (room.prizePaid) revert PrizeAlreadyPaid();

        address winner = room.winner;
        uint256 amount = room.potWei;

        // Effects before interaction.
        room.prizePaid = true;

        (bool ok,) = payable(winner).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit PrizePaid(roomKey, winner, amount);
    }

    // ---------------------------------------------------------------- recovery

    /// @notice Cancel an unsettled room from either pre-settlement state.
    function cancelRoom(bytes32 roomKey, bytes32 reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Room storage room = _rooms[roomKey];
        if (room.status == EscrowStatus.NONE) revert RoomMissing();
        if (room.status == EscrowStatus.SETTLED) revert AlreadySettled();
        if (room.status == EscrowStatus.CANCELED) revert AlreadyCanceled();

        room.status = EscrowStatus.CANCELED;
        room.cancelReason = reason;

        emit RoomCanceled(roomKey, reason);
    }

    /// @notice Permissionless: the funding window closed with seats unfilled.
    function expireUnfunded(bytes32 roomKey) external {
        Room storage room = _rooms[roomKey];
        if (room.status != EscrowStatus.FUNDING) revert NotCancelable();
        if (block.timestamp <= room.fundingDeadline) revert DeadlineNotPassed();

        room.status = EscrowStatus.CANCELED;
        room.cancelReason = bytes32("FUNDING_TIMEOUT");

        emit RoomCanceled(roomKey, room.cancelReason);
    }

    /// @notice Permissionless: funded, but never settled before the resolution deadline.
    ///         This is the only guarantee that a dead backend cannot lock funds.
    function expireUnresolved(bytes32 roomKey) external {
        Room storage room = _rooms[roomKey];
        if (room.status != EscrowStatus.FUNDED) revert NotCancelable();
        if (block.timestamp <= room.resolutionDeadline) revert DeadlineNotPassed();

        room.status = EscrowStatus.CANCELED;
        room.cancelReason = bytes32("RESOLUTION_TIMEOUT");

        emit RoomCanceled(roomKey, room.cancelReason);
    }

    /// @notice Each depositor pulls their own exact stake, once, from a canceled room.
    function withdrawRefund(bytes32 roomKey) external nonReentrant {
        Room storage room = _rooms[roomKey];
        if (room.status == EscrowStatus.NONE) revert RoomMissing();
        if (room.status == EscrowStatus.SETTLED) revert AlreadySettled();
        if (room.status != EscrowStatus.CANCELED) revert NotCancelable();
        if (!deposited[roomKey][msg.sender]) revert NotDepositor();
        if (refundWithdrawn[roomKey][msg.sender]) revert RefundAlreadyWithdrawn();

        uint256 amount = room.entryWei;

        // Effects before interaction.
        refundWithdrawn[roomKey][msg.sender] = true;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RefundWithdrawn(roomKey, msg.sender, amount);
    }

    // ------------------------------------------------------------------- views

    function getRoom(bytes32 roomKey) external view returns (Room memory) {
        return _rooms[roomKey];
    }

    function hasDeposited(bytes32 roomKey, address player) external view returns (bool) {
        return deposited[roomKey][player];
    }

    /// @notice Depositors in deposit order; the host is always index 0.
    function getRoomDepositors(bytes32 roomKey) external view returns (address[] memory) {
        return _depositors[roomKey];
    }

    function entryBounds() external view returns (uint256 min, uint256 max) {
        return (entryMinWei, entryMaxWei);
    }
}

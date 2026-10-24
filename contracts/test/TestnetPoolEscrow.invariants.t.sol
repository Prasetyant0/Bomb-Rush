// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestnetPoolEscrow} from "../src/TestnetPoolEscrow.sol";

/// @notice Drives the escrow through random but *legal-shaped* sequences.
/// @dev Every call is pranked as a plausible actor and most calls are wrapped in
///      try/catch: an invariant run explores states, it does not assert reverts.
///      Revert behaviour is covered by the unit suite in `TestnetPoolEscrow.t.sol`.
///      Min actors per room is 3, so unused actors simply never deposit.
contract EscrowHandler is Test {
    TestnetPoolEscrow public immutable escrow;
    address public immutable admin;
    address public immutable settler;

    address[] public actors;
    bytes32[] public keys;

    /// @dev Ghost accounting: what went in, what came out. The invariant compares
    ///      these against the contract balance, so a leak in either direction fails.
    uint256 public ghostDeposited;
    uint256 public ghostPaidOut;
    uint256 public ghostRefunded;

    /// @dev Keys the handler has actually created, so invariants can iterate them.
    bytes32[] public liveKeys;

    constructor(TestnetPoolEscrow escrow_, address admin_, address settler_) {
        escrow = escrow_;
        admin = admin_;
        settler = settler_;

        for (uint256 i = 0; i < 6; i++) {
            address a = address(uint160(0x1000 + i));
            actors.push(a);
            vm.deal(a, 100 ether);
        }
        for (uint256 i = 0; i < 4; i++) {
            keys.push(keccak256(abi.encode("room", i)));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function liveKeyCount() external view returns (uint256) {
        return liveKeys.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _key(uint256 seed) internal view returns (bytes32) {
        return keys[seed % keys.length];
    }

    // ------------------------------------------------------------- actions

    function createRoom(uint256 actorSeed, uint256 keySeed, uint8 seatsSeed, uint256 fundSeed)
        external
    {
        bytes32 key = _key(keySeed);
        // One room per key: skip if taken, rather than expecting a revert.
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.NONE) return;

        uint8 seats = uint8(bound(seatsSeed, 3, 4));
        uint256 entry = 0.001 ether;

        uint64 fundOff = uint64(bound(fundSeed, 1, 600));
        uint64 resOff = uint64(bound(fundSeed, fundOff + 1, 1200));
        uint64 fund = uint64(block.timestamp) + fundOff;
        uint64 res = uint64(block.timestamp) + resOff;

        address a = _actor(actorSeed);
        vm.prank(a);
        try escrow.createRoom{value: entry}(key, seats, entry, fund, res) {
            liveKeys.push(key);
            ghostDeposited += entry;
        } catch {}
    }

    function joinRoom(uint256 actorSeed, uint256 keySeed) external {
        bytes32 key = _key(keySeed);
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.FUNDING) return;

        address a = _actor(actorSeed);
        if (escrow.hasDeposited(key, a)) return;

        uint256 entry = escrow.getRoom(key).entryWei;
        vm.prank(a);
        try escrow.joinRoom{value: entry}(key) {
            ghostDeposited += entry;
        } catch {}
    }

    function settle(uint256 keySeed, uint256 winnerSeed) external {
        bytes32 key = _key(keySeed);
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.FUNDED) return;

        address[] memory depositors = escrow.getRoomDepositors(key);
        if (depositors.length == 0) return;
        address winner = depositors[winnerSeed % depositors.length];

        vm.prank(settler);
        try escrow.settle(key, winner, keccak256(abi.encode("result", key))) {} catch {}
    }

    function payout(uint256 keySeed) external {
        bytes32 key = _key(keySeed);
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.SETTLED) return;
        if (escrow.getRoom(key).prizePaid) return;

        uint256 pot = escrow.getRoom(key).potWei;
        try escrow.payout(key) {
            ghostPaidOut += pot;
        } catch {}
    }

    function cancelRoom(uint256 keySeed) external {
        bytes32 key = _key(keySeed);
        TestnetPoolEscrow.EscrowStatus st = escrow.getRoom(key).status;
        if (st != TestnetPoolEscrow.EscrowStatus.FUNDING && st != TestnetPoolEscrow.EscrowStatus.FUNDED) {
            return;
        }

        vm.prank(admin);
        try escrow.cancelRoom(key, bytes32("OPERATOR_ABORT")) {} catch {}
    }

    function expireUnfunded(uint256 keySeed) external {
        bytes32 key = _key(keySeed);
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.FUNDING) return;
        try escrow.expireUnfunded(key) {} catch {}
    }

    function expireUnresolved(uint256 keySeed) external {
        bytes32 key = _key(keySeed);
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.FUNDED) return;
        try escrow.expireUnresolved(key) {} catch {}
    }

    function withdrawRefund(uint256 actorSeed, uint256 keySeed) external {
        bytes32 key = _key(keySeed);
        if (escrow.getRoom(key).status != TestnetPoolEscrow.EscrowStatus.CANCELED) return;

        address a = _actor(actorSeed);
        if (!escrow.hasDeposited(key, a) || escrow.refundWithdrawn(key, a)) return;

        uint256 entry = escrow.getRoom(key).entryWei;
        vm.prank(a);
        try escrow.withdrawRefund(key) {
            ghostRefunded += entry;
        } catch {}
    }

    /// @dev Bounded time travel so expiries become reachable without leaving the
    ///      range where nothing has happened yet.
    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 900));
    }
}

/// @notice Stateful invariant suite for `TestnetPoolEscrow`.
/// @dev Satisfies `QA_CROSSPLAY.md` ST18 (balance conservation) at the state level,
///      which per-call fuzzing cannot reach: it is orderings, not values, that break
///      an escrow.
contract TestnetPoolEscrowInvariantTest is Test {
    TestnetPoolEscrow internal escrow;
    EscrowHandler internal handler;

    address internal ADMIN = address(0xAD);
    address internal SETTLER = address(0x5E);

    function setUp() public {
        escrow = new TestnetPoolEscrow(ADMIN, SETTLER, 0.001 ether, 0.01 ether, 600, 1200);
        handler = new EscrowHandler(escrow, ADMIN, SETTLER);

        targetContract(address(handler));
        // Only drive the state through the handler; the escrow itself is not a target,
        // so no invariant is checked against an unreachable state.
        excludeSender(address(escrow));
    }

    /// @notice Nothing was created out of thin air and nothing was lost:
    ///         every wei that entered is either still held, paid as a prize, or refunded.
    function invariant_conservation() public view {
        assertEq(
            address(escrow).balance + handler.ghostPaidOut() + handler.ghostRefunded(),
            handler.ghostDeposited(),
            "escrow lost or minted value"
        );
    }

    /// @notice The contract can always cover what it owes. This is the property that
    ///         a refund bug would break without changing the totals above: paying one
    ///         depositor twice still conserves the sum but leaves a later one unpaid.
    function invariant_balanceCoversObligations() public view {
        uint256 owed = 0;
        uint256 n = handler.liveKeyCount();

        for (uint256 i = 0; i < n; i++) {
            bytes32 key = handler.liveKeys(i);
            owed += _owedFor(key);
        }

        assertGe(address(escrow).balance, owed, "escrow cannot cover its obligations");
    }

    /// @notice Every room's stored pot is exactly `entryWei * depositCount`, never
    ///         inflated by an unsolicited transfer or by accumulating `msg.value`.
    function invariant_potMatchesAccounting() public view {
        uint256 n = handler.liveKeyCount();

        for (uint256 i = 0; i < n; i++) {
            bytes32 key = handler.liveKeys(i);
            TestnetPoolEscrow.Room memory r = escrow.getRoom(key);

            assertEq(
                r.potWei,
                r.entryWei * r.depositCount,
                "pot diverged from entryWei * depositCount"
            );
            assertLe(r.depositCount, r.maxSeats, "more depositors than seats");
            assertGe(r.depositCount, 1, "room exists with no depositor");
        }
    }

    /// @notice Settlement and refund are mutually exclusive at every reachable state:
    ///         a settled room never refunds, a refunded room never pays a prize.
    function invariant_settleAndRefundExclusive() public view {
        uint256 n = handler.liveKeyCount();

        for (uint256 i = 0; i < n; i++) {
            bytes32 key = handler.liveKeys(i);
            TestnetPoolEscrow.Room memory r = escrow.getRoom(key);

            if (r.status == TestnetPoolEscrow.EscrowStatus.SETTLED) {
                address[] memory depositors = escrow.getRoomDepositors(key);
                for (uint256 j = 0; j < depositors.length; j++) {
                    assertFalse(
                        escrow.refundWithdrawn(key, depositors[j]),
                        "settled room must never refund"
                    );
                }
            }

            if (r.status == TestnetPoolEscrow.EscrowStatus.CANCELED) {
                assertFalse(r.prizePaid, "canceled room must never pay a prize");
                assertEq(r.winner, address(0), "canceled room must not name a winner");
            }

            if (r.status == TestnetPoolEscrow.EscrowStatus.FUNDING
                || r.status == TestnetPoolEscrow.EscrowStatus.FUNDED) {
                assertFalse(r.prizePaid, "unsettled room cannot have paid");
            }
        }
    }

    /// @notice A winner, once recorded, is always one of that room's depositors.
    function invariant_winnerIsDepositor() public view {
        uint256 n = handler.liveKeyCount();

        for (uint256 i = 0; i < n; i++) {
            bytes32 key = handler.liveKeys(i);
            TestnetPoolEscrow.Room memory r = escrow.getRoom(key);

            if (r.status == TestnetPoolEscrow.EscrowStatus.SETTLED) {
                assertTrue(escrow.hasDeposited(key, r.winner), "winner was not a depositor");
                assertTrue(r.winner != address(0), "settled room has no winner");
                assertTrue(r.resultHash != bytes32(0), "settled room has no result hash");
            }
        }
    }

    // -------------------------------------------------------------- helpers

    /// @dev What the contract still owes for one room, given its state.
    function _owedFor(bytes32 key) internal view returns (uint256) {
        TestnetPoolEscrow.Room memory r = escrow.getRoom(key);
        if (r.status == TestnetPoolEscrow.EscrowStatus.NONE) return 0;

        if (r.status == TestnetPoolEscrow.EscrowStatus.FUNDING
            || r.status == TestnetPoolEscrow.EscrowStatus.FUNDED) {
            return r.entryWei * r.depositCount;
        }

        if (r.status == TestnetPoolEscrow.EscrowStatus.SETTLED) {
            return r.prizePaid ? 0 : r.potWei;
        }

        // CANCELED: whatever has not been withdrawn yet.
        uint256 outstanding = 0;
        address[] memory depositors = escrow.getRoomDepositors(key);
        for (uint256 j = 0; j < depositors.length; j++) {
            if (!escrow.refundWithdrawn(key, depositors[j])) outstanding += r.entryWei;
        }
        return outstanding;
    }
}

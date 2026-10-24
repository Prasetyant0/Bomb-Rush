// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestnetPoolEscrow} from "../src/TestnetPoolEscrow.sol";

/// @notice Receives native MON but tries to re-enter on every payment.
contract ReentrantWinner {
    TestnetPoolEscrow private escrow;
    bytes32 private key;
    bool private armed;

    constructor(TestnetPoolEscrow escrow_) {
        escrow = escrow_;
    }

    function arm(bytes32 key_) external {
        key = key_;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function deposit(bytes32 key_, uint256 amount) external {
        escrow.joinRoom{value: amount}(key_);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            // Both paths are guarded; the test asserts the outer call succeeds and
            // the pot is not drained twice.
            escrow.payout(key);
        }
    }
}

/// @notice Rejects every payment, permanently.
contract RejectingReceiver {
    TestnetPoolEscrow private escrow;

    constructor(TestnetPoolEscrow escrow_) {
        escrow = escrow_;
    }

    function deposit(bytes32 key_, uint256 amount) external {
        escrow.joinRoom{value: amount}(key_);
    }

    receive() external payable {
        revert("NO");
    }
}

contract TestnetPoolEscrowTest is Test {
    TestnetPoolEscrow internal escrow;

    address internal ADMIN = address(0xAD);
    address internal SETTLER = address(0x5E);
    address internal HOST = address(0x1101);
    address internal P2 = address(0x2202);
    address internal P3 = address(0x3303);
    address internal P4 = address(0x4404);
    address internal STRANGER = address(0xBAD);

    uint256 internal constant ENTRY = 0.001 ether;
    uint256 internal constant MIN_ENTRY = 0.001 ether;
    uint256 internal constant MAX_ENTRY = 0.01 ether;
    uint64 internal constant FUNDING_WINDOW = 600;
    uint64 internal constant RESOLUTION_WINDOW = 1200;

    bytes32 internal constant KEY = keccak256("room-1");
    bytes32 internal constant RESULT = keccak256("result-1");

    function setUp() public {
        escrow = new TestnetPoolEscrow(
            ADMIN, SETTLER, MIN_ENTRY, MAX_ENTRY, FUNDING_WINDOW, RESOLUTION_WINDOW
        );

        vm.deal(HOST, 10 ether);
        vm.deal(P2, 10 ether);
        vm.deal(P3, 10 ether);
        vm.deal(P4, 10 ether);
        vm.deal(STRANGER, 10 ether);
    }

    // ------------------------------------------------------------- helpers

    function _deadlines() internal view returns (uint64 fund, uint64 res) {
        fund = uint64(block.timestamp) + FUNDING_WINDOW;
        res = uint64(block.timestamp) + RESOLUTION_WINDOW;
    }

    function _createThreeSeat() internal returns (uint64 fund, uint64 res) {
        (fund, res) = _deadlines();
        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, fund, res);
    }

    function _fundThree() internal {
        _createThreeSeat();
        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);
        vm.prank(P3);
        escrow.joinRoom{value: ENTRY}(KEY);
    }

    function _settle(address winner) internal {
        vm.prank(SETTLER);
        escrow.settle(KEY, winner, RESULT);
    }

    // ------------------------------------------------------ create / funding

    function test_create_valid_host_funded() public {
        (uint64 fund, uint64 res) = _deadlines();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit TestnetPoolEscrow.RoomCreated(KEY, HOST, ENTRY, 3, fund, res);

        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, fund, res);

        TestnetPoolEscrow.Room memory r = escrow.getRoom(KEY);
        assertEq(r.host, HOST);
        assertEq(r.maxSeats, 3);
        assertEq(r.depositCount, 1);
        assertEq(r.potWei, ENTRY);
        assertEq(uint8(r.status), uint8(TestnetPoolEscrow.EscrowStatus.FUNDING));
        assertTrue(escrow.hasDeposited(KEY, HOST));

        address[] memory d = escrow.getRoomDepositors(KEY);
        assertEq(d.length, 1);
        assertEq(d[0], HOST, "host must be depositor index 0");
    }

    function test_create_emitsHostDepositConfirmed() public {
        (uint64 fund, uint64 res) = _deadlines();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit TestnetPoolEscrow.DepositConfirmed(KEY, HOST, ENTRY, 1);

        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, fund, res);
    }

    function test_create_duplicate_id_reverts() public {
        _createThreeSeat();
        (uint64 fund, uint64 res) = _deadlines();

        vm.prank(P2);
        vm.expectRevert(TestnetPoolEscrow.RoomExists.selector);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, fund, res);
    }

    function test_create_zero_key_reverts() public {
        (uint64 fund, uint64 res) = _deadlines();
        vm.prank(HOST);
        vm.expectRevert(TestnetPoolEscrow.ZeroRoomKey.selector);
        escrow.createRoom{value: ENTRY}(bytes32(0), 3, ENTRY, fund, res);
    }

    function test_seats_outside_3_4_reverts() public {
        (uint64 fund, uint64 res) = _deadlines();

        vm.startPrank(HOST);
        vm.expectRevert(TestnetPoolEscrow.BadSeats.selector);
        escrow.createRoom{value: ENTRY}(KEY, 2, ENTRY, fund, res);

        vm.expectRevert(TestnetPoolEscrow.BadSeats.selector);
        escrow.createRoom{value: ENTRY}(KEY, 5, ENTRY, fund, res);
        vm.stopPrank();
    }

    function test_bad_entry_reverts() public {
        (uint64 fund, uint64 res) = _deadlines();

        vm.startPrank(HOST);
        vm.expectRevert(TestnetPoolEscrow.BadEntry.selector);
        escrow.createRoom{value: MIN_ENTRY / 2}(KEY, 3, MIN_ENTRY / 2, fund, res);

        vm.expectRevert(TestnetPoolEscrow.BadEntry.selector);
        escrow.createRoom{value: MAX_ENTRY * 2}(KEY, 3, MAX_ENTRY * 2, fund, res);
        vm.stopPrank();
    }

    function test_wrong_value_on_create_reverts() public {
        (uint64 fund, uint64 res) = _deadlines();

        // Underpay, exact-value check fires.
        vm.prank(HOST);
        vm.expectRevert(TestnetPoolEscrow.WrongValue.selector);
        escrow.createRoom{value: ENTRY - 1}(KEY, 3, ENTRY, fund, res);

        // Overpay: also rejected, so no stray balance accrues.
        vm.prank(HOST);
        vm.expectRevert(TestnetPoolEscrow.WrongValue.selector);
        escrow.createRoom{value: ENTRY + 1}(KEY, 3, ENTRY, fund, res);
    }

    function test_bad_deadlines_revert() public {
        uint64 nowTs = uint64(block.timestamp);

        vm.startPrank(HOST);
        // Already in the past.
        vm.expectRevert(TestnetPoolEscrow.BadDeadlines.selector);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, nowTs, nowTs + 100);

        // Resolution not after funding.
        vm.expectRevert(TestnetPoolEscrow.BadDeadlines.selector);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, nowTs + 500, nowTs + 400);

        // Funding window longer than the cap.
        vm.expectRevert(TestnetPoolEscrow.BadDeadlines.selector);
        escrow.createRoom{value:
            ENTRY}(KEY, 3, ENTRY, nowTs + FUNDING_WINDOW + 1, nowTs + RESOLUTION_WINDOW);
        vm.stopPrank();
    }

    function test_join_exact_amount() public {
        _createThreeSeat();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit TestnetPoolEscrow.DepositConfirmed(KEY, P2, ENTRY, 2);

        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);

        TestnetPoolEscrow.Room memory r = escrow.getRoom(KEY);
        assertEq(r.depositCount, 2);
        assertEq(r.potWei, ENTRY * 2);
        assertTrue(escrow.hasDeposited(KEY, P2));
    }

    function test_join_wrong_amount_reverts() public {
        _createThreeSeat();

        vm.prank(P2);
        vm.expectRevert(TestnetPoolEscrow.WrongValue.selector);
        escrow.joinRoom{value: ENTRY / 2}(KEY);
    }

    function test_duplicate_wallet_reverts() public {
        _createThreeSeat();

        vm.startPrank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);
        vm.expectRevert(TestnetPoolEscrow.AlreadyDeposited.selector);
        escrow.joinRoom{value: ENTRY}(KEY);
        vm.stopPrank();

        assertEq(escrow.getRoom(KEY).depositCount, 2);
    }

    function test_host_cannot_double_deposit() public {
        _createThreeSeat();

        vm.prank(HOST);
        vm.expectRevert(TestnetPoolEscrow.AlreadyDeposited.selector);
        escrow.joinRoom{value: ENTRY}(KEY);
    }

    function test_funding_to_funded_exact_seats() public {
        _createThreeSeat();

        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);
        assertEq(
            uint8(escrow.getRoom(KEY).status), uint8(TestnetPoolEscrow.EscrowStatus.FUNDING)
        );

        vm.expectEmit(true, false, false, true, address(escrow));
        emit TestnetPoolEscrow.RoomFunded(KEY, ENTRY * 3);

        vm.prank(P3);
        escrow.joinRoom{value: ENTRY}(KEY);

        TestnetPoolEscrow.Room memory r = escrow.getRoom(KEY);
        assertEq(uint8(r.status), uint8(TestnetPoolEscrow.EscrowStatus.FUNDED));
        assertEq(r.potWei, ENTRY * 3);
    }

    function test_join_after_funded_reverts() public {
        _fundThree();

        vm.prank(P4);
        vm.expectRevert(TestnetPoolEscrow.RoomNotFunding.selector);
        escrow.joinRoom{value: ENTRY}(KEY);
    }

    function test_funding_window_reverts() public {
        (uint64 fund,) = _createThreeSeat();

        vm.warp(fund + 1);
        vm.prank(P2);
        vm.expectRevert(TestnetPoolEscrow.DeadlinePassed.selector);
        escrow.joinRoom{value: ENTRY}(KEY);
    }

    function test_forced_transfer_does_not_inflate_pot() public {
        _createThreeSeat();

        // Simulate an unsolicited native transfer (selfdestruct-style force).
        vm.deal(address(escrow), address(escrow).balance + 5 ether);

        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);

        assertEq(escrow.getRoom(KEY).potWei, ENTRY * 2, "pot derives from entry*count only");
    }

    // ------------------------------------------------------------ settlement

    function test_settle_only_settler() public {
        _fundThree();

        vm.prank(STRANGER);
        vm.expectRevert();
        escrow.settle(KEY, P2, RESULT);
    }

    function test_settle_non_depositor_reverts() public {
        _fundThree();

        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.WinnerNotDepositor.selector);
        escrow.settle(KEY, STRANGER, RESULT);
    }

    function test_settle_zero_winner_reverts() public {
        _fundThree();

        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.ZeroWinner.selector);
        escrow.settle(KEY, address(0), RESULT);
    }

    function test_settle_zero_result_hash_reverts() public {
        _fundThree();

        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.ZeroResultHash.selector);
        escrow.settle(KEY, P2, bytes32(0));
    }

    function test_settle_before_funded_reverts() public {
        _createThreeSeat();

        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.NotFunded.selector);
        escrow.settle(KEY, HOST, RESULT);
    }

    function test_settle_duplicate_reverts() public {
        _fundThree();
        _settle(P2);

        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.AlreadySettled.selector);
        escrow.settle(KEY, P3, RESULT);
    }

    function test_settle_after_resolution_deadline_reverts() public {
        _fundThree();
        (, uint64 res) = _deadlines();

        vm.warp(res + 1);
        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.DeadlinePassed.selector);
        escrow.settle(KEY, P2, RESULT);
    }

    function test_settle_emits_and_credits_claim() public {
        _fundThree();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit TestnetPoolEscrow.MatchSettled(KEY, P2, ENTRY * 3, RESULT);

        vm.prank(SETTLER);
        escrow.settle(KEY, P2, RESULT);

        TestnetPoolEscrow.Room memory r = escrow.getRoom(KEY);
        assertEq(uint8(r.status), uint8(TestnetPoolEscrow.EscrowStatus.SETTLED));
        assertEq(r.winner, P2);
        assertEq(r.resultHash, RESULT);
        assertFalse(r.prizePaid, "settle must not transfer");
        assertEq(address(escrow).balance, ENTRY * 3, "pot still held");
    }

    // ---------------------------------------------------------------- payout

    function test_payout_before_settle_reverts() public {
        _fundThree();

        vm.expectRevert(TestnetPoolEscrow.NotSettled.selector);
        escrow.payout(KEY);
    }

    function test_payout_once() public {
        _fundThree();
        _settle(P2);

        uint256 before = P2.balance;

        vm.expectEmit(true, true, false, true, address(escrow));
        emit TestnetPoolEscrow.PrizePaid(KEY, P2, ENTRY * 3);

        escrow.payout(KEY);

        assertEq(P2.balance, before + ENTRY * 3);
        assertTrue(escrow.getRoom(KEY).prizePaid);
        assertEq(address(escrow).balance, 0);

        vm.expectRevert(TestnetPoolEscrow.PrizeAlreadyPaid.selector);
        escrow.payout(KEY);
    }

    function test_payout_to_recorded_winner_only() public {
        _fundThree();
        _settle(P2);

        uint256 p3Before = P3.balance;
        uint256 strangerBefore = STRANGER.balance;
        uint256 p2Before = P2.balance;

        // A third party triggers it; the recipient is still the recorded winner.
        vm.prank(STRANGER);
        escrow.payout(KEY);

        assertEq(P2.balance, p2Before + ENTRY * 3);
        assertEq(P3.balance, p3Before);
        assertEq(STRANGER.balance, strangerBefore);
    }

    function test_rejecting_receiver_does_not_consume_claim() public {
        RejectingReceiver bad = new RejectingReceiver(escrow);
        vm.deal(address(bad), ENTRY);

        (uint64 fund, uint64 res) = _deadlines();
        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, fund, res);
        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);
        bad.deposit(KEY, ENTRY);

        vm.prank(SETTLER);
        escrow.settle(KEY, address(bad), RESULT);

        vm.expectRevert(TestnetPoolEscrow.TransferFailed.selector);
        escrow.payout(KEY);

        // The claim is not consumed: the contract still holds the pot.
        assertFalse(escrow.getRoom(KEY).prizePaid);
        assertEq(address(escrow).balance, ENTRY * 3);
    }

    /// @notice A receiver that tries to re-enter on payment cannot drain the pot.
    ///
    /// The re-entrant `payout` hits `nonReentrant` and reverts, which unwinds the
    /// receiver's `receive()`, which unwinds the outer `call{value}` and surfaces as
    /// `TransferFailed`. The prize is *not* consumed, so the pot stays claimable — the
    /// safe failure. This is also the disclosed contract-wallet limitation: a wallet
    /// that always reverts on receipt cannot be paid (SMART_CONTRACT_SPEC.md §"Known
    /// recipient limitation").
    function test_reentrancy_receiver_cannot_drain() public {
        ReentrantWinner attacker = new ReentrantWinner(escrow);
        vm.deal(address(attacker), ENTRY);

        (uint64 fund, uint64 res) = _deadlines();
        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(KEY, 3, ENTRY, fund, res);
        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);
        attacker.deposit(KEY, ENTRY);

        vm.prank(SETTLER);
        escrow.settle(KEY, address(attacker), RESULT);

        attacker.arm(KEY);
        uint256 pot = ENTRY * 3;

        vm.expectRevert(TestnetPoolEscrow.TransferFailed.selector);
        escrow.payout(KEY);

        // No double payment, no lost funds: the claim is intact and retryable.
        assertFalse(escrow.getRoom(KEY).prizePaid, "prize must not be consumed");
        assertEq(address(escrow).balance, pot, "pot still held");
        assertEq(address(attacker).balance, 0, "attacker received nothing");

        // A second attempt without the re-entrant hook is still payable.
        attacker.disarm();
        escrow.payout(KEY);
        assertTrue(escrow.getRoom(KEY).prizePaid);
        assertEq(address(attacker).balance, pot);
        assertEq(address(escrow).balance, 0);
    }

    // ------------------------------------------------------- cancel / expire

    function test_cancel_only_admin() public {
        _createThreeSeat();

        vm.prank(STRANGER);
        vm.expectRevert();
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));

        vm.prank(SETTLER);
        vm.expectRevert();
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));
    }

    function test_cancel_enables_refunds() public {
        _fundThree();

        vm.prank(ADMIN);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TestnetPoolEscrow.RoomCanceled(KEY, bytes32("OPERATOR_ABORT"));
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));

        assertEq(
            uint8(escrow.getRoom(KEY).status), uint8(TestnetPoolEscrow.EscrowStatus.CANCELED)
        );
        assertEq(escrow.getRoom(KEY).cancelReason, bytes32("OPERATOR_ABORT"));
    }

    function test_canceled_cannot_settle() public {
        _fundThree();

        vm.prank(ADMIN);
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));

        vm.prank(SETTLER);
        vm.expectRevert(TestnetPoolEscrow.AlreadyCanceled.selector);
        escrow.settle(KEY, P2, RESULT);
    }

    function test_settled_cannot_cancel() public {
        _fundThree();
        _settle(P2);

        vm.prank(ADMIN);
        vm.expectRevert(TestnetPoolEscrow.AlreadySettled.selector);
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));
    }

    function test_settled_cannot_refund() public {
        _fundThree();
        _settle(P2);

        vm.prank(HOST);
        vm.expectRevert(TestnetPoolEscrow.AlreadySettled.selector);
        escrow.withdrawRefund(KEY);
    }

    function test_expire_unfunded_is_permissionless() public {
        (uint64 fund,) = _createThreeSeat();

        // Too early.
        vm.prank(STRANGER);
        vm.expectRevert(TestnetPoolEscrow.DeadlineNotPassed.selector);
        escrow.expireUnfunded(KEY);

        vm.warp(fund + 1);
        vm.prank(STRANGER);
        escrow.expireUnfunded(KEY);

        TestnetPoolEscrow.Room memory r = escrow.getRoom(KEY);
        assertEq(uint8(r.status), uint8(TestnetPoolEscrow.EscrowStatus.CANCELED));
        assertEq(r.cancelReason, bytes32("FUNDING_TIMEOUT"));
    }

    function test_expire_unresolved_is_permissionless() public {
        _fundThree();
        (, uint64 res) = _deadlines();

        vm.prank(STRANGER);
        vm.expectRevert(TestnetPoolEscrow.DeadlineNotPassed.selector);
        escrow.expireUnresolved(KEY);

        vm.warp(res + 1);
        vm.prank(STRANGER);
        escrow.expireUnresolved(KEY);

        assertEq(
            uint8(escrow.getRoom(KEY).status), uint8(TestnetPoolEscrow.EscrowStatus.CANCELED)
        );
        assertEq(escrow.getRoom(KEY).cancelReason, bytes32("RESOLUTION_TIMEOUT"));
    }

    function test_expire_unfunded_on_funded_room_reverts() public {
        _fundThree();
        (uint64 fund,) = _deadlines();

        vm.warp(fund + 1);
        vm.expectRevert(TestnetPoolEscrow.NotCancelable.selector);
        escrow.expireUnfunded(KEY);
    }

    // --------------------------------------------------------------- refunds

    function test_refund_only_depositor() public {
        _fundThree();

        vm.prank(ADMIN);
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));

        vm.prank(STRANGER);
        vm.expectRevert(TestnetPoolEscrow.NotDepositor.selector);
        escrow.withdrawRefund(KEY);
    }

    function test_refund_only_when_canceled() public {
        _fundThree();

        vm.prank(HOST);
        vm.expectRevert(TestnetPoolEscrow.NotCancelable.selector);
        escrow.withdrawRefund(KEY);
    }

    function test_double_refund_reverts() public {
        _fundThree();

        vm.prank(ADMIN);
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));

        vm.startPrank(HOST);
        escrow.withdrawRefund(KEY);
        vm.expectRevert(TestnetPoolEscrow.RefundAlreadyWithdrawn.selector);
        escrow.withdrawRefund(KEY);
        vm.stopPrank();
    }

    function test_refund_returns_exact_entry_to_each_depositor() public {
        _fundThree();

        vm.prank(ADMIN);
        escrow.cancelRoom(KEY, bytes32("OPERATOR_ABORT"));

        address[3] memory players = [HOST, P2, P3];
        for (uint256 i = 0; i < players.length; i++) {
            uint256 before = players[i].balance;
            vm.prank(players[i]);
            escrow.withdrawRefund(KEY);
            assertEq(players[i].balance, before + ENTRY);
        }

        assertEq(address(escrow).balance, 0);
    }

    // ------------------------------------------------------------- invariants

    /// @notice Balance conservation across the full lifecycle: every wei that came in
    ///         leaves exactly once, to a prize or to refunds, never both.
    function testFuzz_balance_conservation(uint8 seatsSeed, uint256 winnerIdx) public {
        uint8 seats = uint8(bound(seatsSeed, 3, 4));
        address[4] memory players = [HOST, P2, P3, P4];
        bytes32 key = keccak256(abi.encode("fuzz", seatsSeed));

        (uint64 fund, uint64 res) = _deadlines();
        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(key, seats, ENTRY, fund, res);
        for (uint256 i = 1; i < seats; i++) {
            vm.prank(players[i]);
            escrow.joinRoom{value: ENTRY}(key);
        }

        uint256 pot = ENTRY * seats;
        assertEq(address(escrow).balance, pot);
        assertEq(escrow.getRoom(key).potWei, pot);

        // Branch: settle + payout, OR cancel + full refund.
        if (bound(winnerIdx, 0, 1) == 1) {
            address winner = players[bound(winnerIdx, 0, seats - 1)];
            vm.prank(SETTLER);
            escrow.settle(key, winner, RESULT);

            uint256 before = winner.balance;
            escrow.payout(key);
            assertEq(winner.balance, before + pot);
            assertEq(address(escrow).balance, 0);
        } else {
            vm.prank(ADMIN);
            escrow.cancelRoom(key, bytes32("OPERATOR_ABORT"));

            for (uint256 i = 0; i < seats; i++) {
                vm.prank(players[i]);
                escrow.withdrawRefund(key);
            }
            assertEq(address(escrow).balance, 0);
        }
    }

    function test_replay_across_room_ids() public {
        _fundThree();
        _settle(P2);
        escrow.payout(KEY);

        // A different room key is an independent room; replaying the same winner and
        // hash there is a separate settlement, not a replay of this one.
        bytes32 other = keccak256("room-2");
        (uint64 fund, uint64 res) = _deadlines();
        vm.prank(HOST);
        escrow.createRoom{value: ENTRY}(other, 3, ENTRY, fund, res);

        TestnetPoolEscrow.Room memory r = escrow.getRoom(other);
        assertEq(uint8(r.status), uint8(TestnetPoolEscrow.EscrowStatus.FUNDING));
        assertEq(r.winner, address(0));
        assertFalse(r.prizePaid);
    }

    function test_events_carry_receipt_fields() public {
        // DepositConfirmed must carry (roomKey, player, amountWei, count) so the server
        // can verify a deposit from the log alone.
        _createThreeSeat();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit TestnetPoolEscrow.DepositConfirmed(KEY, P2, ENTRY, 2);
        vm.prank(P2);
        escrow.joinRoom{value: ENTRY}(KEY);
    }

    function test_entry_bounds_readable() public view {
        (uint256 lo, uint256 hi) = escrow.entryBounds();
        assertEq(lo, MIN_ENTRY);
        assertEq(hi, MAX_ENTRY);
    }

    function test_roles_are_separated() public view {
        assertTrue(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertFalse(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), SETTLER));
        assertTrue(escrow.hasRole(escrow.SETTLER_ROLE(), SETTLER));
        assertFalse(escrow.hasRole(escrow.SETTLER_ROLE(), ADMIN));
    }
}

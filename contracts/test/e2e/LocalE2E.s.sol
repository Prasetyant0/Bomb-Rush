// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestnetPoolEscrow} from "../../src/TestnetPoolEscrow.sol";

/// @notice Deposits into a room, then refuses every incoming payment until
///         `disarm()` is called.
///
/// Used by `scripts/e2e-escrow.sh` to prove QA_CROSSPLAY ST08 against a real
/// chain: `payout` to a rejecting recipient must revert *and* leave the prize
/// claimable. The script then disarms the receiver and pays again, which proves
/// the claim was never consumed and leaves the chain fully drained.
contract RejectingDepositor {
    TestnetPoolEscrow public immutable escrow;
    bool public rejecting = true;

    constructor(TestnetPoolEscrow escrow_) {
        escrow = escrow_;
    }

    function deposit(bytes32 roomKey) external payable {
        escrow.joinRoom{value: msg.value}(roomKey);
    }

    /// @notice Stop rejecting. Stands in for the winner fixing its own receiver.
    function disarm() external {
        rejecting = false;
    }

    receive() external payable {
        if (rejecting) revert("RejectingDepositor: no");
    }
}

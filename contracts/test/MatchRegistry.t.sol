// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchRegistry} from "../src/MatchRegistry.sol";

/// @notice Smoke coverage for the four cases in `docs/spec/TRD.md` §6 plus the
/// guest/duplicate/read-back paths the server actually depends on.
/// Anything beyond this is P2 by scope.
contract MatchRegistryTest is Test {
    MatchRegistry internal registry;

    address internal constant OPERATOR = address(0xA11CE);
    address internal constant STRANGER = address(0xB0B);
    address internal constant WINNER = address(0xCAFE);

    bytes32 internal constant MATCH_ID = keccak256("m_7f3a");
    bytes32 internal constant RESULT_HASH = keccak256("result");
    bytes32 internal constant GUEST_HASH = bytes32(0);

    event MatchRecorded(bytes32 indexed matchId, address indexed winner, bytes32 resultHash);

    function setUp() public {
        vm.prank(OPERATOR);
        registry = new MatchRegistry();
    }

    // 1. Owner can record a match; isRecorded becomes true and the event emits.
    function test_OwnerCanRecord() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit MatchRecorded(MATCH_ID, WINNER, RESULT_HASH);

        vm.prank(OPERATOR);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, RESULT_HASH);

        assertTrue(registry.isRecorded(MATCH_ID));

        MatchRegistry.Match memory m = registry.getMatch(MATCH_ID);
        assertEq(m.winner, WINNER);
        assertEq(m.guestHash, GUEST_HASH);
        assertEq(m.resultHash, RESULT_HASH);
        assertEq(m.recordedAt, uint64(block.timestamp));
    }

    // 2. Non-owner call reverts NotOwner.
    function test_RevertWhen_NotOwner() public {
        vm.prank(STRANGER);
        vm.expectRevert(MatchRegistry.NotOwner.selector);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, RESULT_HASH);
    }

    // 3. Duplicate matchId reverts AlreadyRecorded.
    function test_RevertWhen_AlreadyRecorded() public {
        vm.startPrank(OPERATOR);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, RESULT_HASH);

        vm.expectRevert(MatchRegistry.AlreadyRecorded.selector);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, RESULT_HASH);
        vm.stopPrank();
    }

    // 4. resultHash == 0 reverts ZeroResultHash.
    function test_RevertWhen_ZeroResultHash() public {
        vm.prank(OPERATOR);
        vm.expectRevert(MatchRegistry.ZeroResultHash.selector);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, bytes32(0));
    }

    // 5. A guest win stores the zero address and keeps a non-zero guestHash.
    function test_GuestWin() public {
        bytes32 guest = keccak256("guest");
        vm.prank(OPERATOR);
        registry.recordMatch(MATCH_ID, address(0), guest, RESULT_HASH);

        MatchRegistry.Match memory m = registry.getMatch(MATCH_ID);
        assertEq(m.winner, address(0));
        assertEq(m.guestHash, guest);
    }

    // 6. Unrecorded match reads back as a zeroed struct, not a revert.
    function test_GetUnknownMatch() public view {
        MatchRegistry.Match memory m = registry.getMatch(keccak256("m_unknown"));
        assertEq(m.winner, address(0));
        assertEq(m.resultHash, bytes32(0));
        assertEq(m.recordedAt, 0);
        assertFalse(registry.isRecorded(keccak256("m_unknown")));
    }

    // 7. The zero-result-hash guard runs before the duplicate guard, so a bad
    //    payload never leaves a recorded slot behind.
    function test_ZeroHashDoesNotRecord() public {
        vm.prank(OPERATOR);
        vm.expectRevert(MatchRegistry.ZeroResultHash.selector);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, bytes32(0));

        assertFalse(registry.isRecorded(MATCH_ID));
    }

    // 8. Distinct match ids record independently.
    function test_MultipleMatches() public {
        bytes32 second = keccak256("m_8b2c");
        vm.startPrank(OPERATOR);
        registry.recordMatch(MATCH_ID, WINNER, GUEST_HASH, RESULT_HASH);
        registry.recordMatch(second, WINNER, GUEST_HASH, keccak256("result2"));
        vm.stopPrank();

        assertTrue(registry.isRecorded(MATCH_ID));
        assertTrue(registry.isRecorded(second));
        assertEq(registry.getMatch(second).resultHash, keccak256("result2"));
    }

    // 9. Canonical hash parity — the off-chain `resultHash` is ABI-encoded, not
    //    concatenated. This recomputes it in Solidity with `abi.encode` and
    //    asserts it against a value produced by viem's `encodeAbiParameters`
    //    (`packages/shared/src/hash.ts`). If either side changes its encoding,
    //    this test fails before a mismatch can reach the chain.
    function test_ResultHashMatchesCanonicalEncoding() public pure {
        string[] memory ids = new string[](3);
        ids[0] = "p_1";
        ids[1] = "p_10";
        ids[2] = "p_2";

        bytes32 onChain = keccak256(
            abi.encode("m_7f3a", "p_1", ids, uint256(100))
        );

        // Produced with cast/viem from the canonical encoding in
        // `docs/spec/API_CONTRACT.md` §2:
        //   cast keccak "$(cast abi-encode 'f(string,string,string[],uint256)' \
        //     'm_7f3a' 'p_1' '["p_1","p_10","p_2"]' 100)"
        assertEq(
            onChain,
            bytes32(0xf54f7a010fe8df42120bd635e3f6a036abd3715386885f67e9823e2b59115120),
            "resultHash encoding drifted from API_CONTRACT.md"
        );
    }
}

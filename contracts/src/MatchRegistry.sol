// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MatchRegistry
/// @notice Records the outcome of a finished BOMB RUSH 3D match on Monad Testnet.
/// @dev Deliberately minimal: `onlyOwner`, no signature scheme, no value handling.
///
/// The chain provides an audit trail, not trustlessness. The winner is decided
/// by the operator's authoritative game server; this contract makes that
/// decision public, timestamped and non-repudiable. It never decides who won.
///
/// Scope is frozen by `docs/spec/TRD.md` §6 and `docs/spec/MVP_SCOPE.md`:
/// one match id, one winner, two hashes. No deposits, no escrow, no payouts,
/// no upgradeability, no ERC-20/721 surface. Adding any of those is a scope
/// change requiring legal review, not an optimisation.
///
/// OpenZeppelin `Ownable` is intentionally not used: this contract's revert
/// codes (`NotOwner`, `AlreadyRecorded`, `ZeroResultHash`) are asserted by QA
/// and consumed by the server's "already recorded" path, and `Ownable`'s
/// `OwnableUnauthorizedAccount(address)` selector differs. A 40-line contract
/// with three named errors is smaller than the adapter that would reconcile
/// the two ABIs.
contract MatchRegistry {
    struct Match {
        address winner;
        bytes32 guestHash;
        bytes32 resultHash;
        uint64 recordedAt;
    }

    /// @notice The operator key that submits results. One operator, one key.
    address public owner;

    mapping(bytes32 => Match) private matches;
    mapping(bytes32 => bool) public isRecorded;

    event MatchRecorded(bytes32 indexed matchId, address indexed winner, bytes32 resultHash);

    error NotOwner();
    error AlreadyRecorded();
    error ZeroResultHash();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Record a finished match. Reverts on any duplicate `matchId`.
    /// @param matchId `keccak256(toHex(offChainMatchId))`, converted once by the server.
    /// @param winner Winner's wallet, or `address(0)` when the winner had no wallet.
    /// @param guestHash Non-zero iff `winner` is the zero address; else `bytes32(0)`.
    /// @param resultHash Canonical hash of `(matchId, winnerId, sortedPlayerIds, entryCredits)`.
    function recordMatch(bytes32 matchId, address winner, bytes32 guestHash, bytes32 resultHash)
        external
        onlyOwner
    {
        if (isRecorded[matchId]) revert AlreadyRecorded();
        if (resultHash == bytes32(0)) revert ZeroResultHash();

        matches[matchId] = Match({
            winner: winner,
            guestHash: guestHash,
            resultHash: resultHash,
            recordedAt: uint64(block.timestamp)
        });
        isRecorded[matchId] = true;

        emit MatchRecorded(matchId, winner, resultHash);
    }

    /// @notice Read back a recorded match. Returns a zeroed struct when absent.
    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return matches[matchId];
    }
}

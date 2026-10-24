// Canonical settlement preimage (contracts/ABI_HANDOFF.md §5).
// This is an external interface: packages/shared must produce the same bytes, or
// an observer cannot recompute the hash from a published match record.
import { encodeAbiParameters, keccak256, type Hex } from 'viem';

export const RESULT_PROTOCOL_TAG = 'BOMB_RUSH_V05';
export const RESULT_VERSION = '0.5';

export interface ResultHashInput {
  roomKey: Hex;
  matchId: string;
  participantIds: string[];
  winner: `0x${string}`;
}

// Lexicographic ascending by UTF-16 code unit — the same `<`/`>` comparison
// used in the reference implementation. NOT locale-aware, NOT join order.
export function sortParticipantIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * keccak256(abi.encode("BOMB_RUSH_V05", roomKey, matchId, sortedParticipantIds, winner, "0.5"))
 *
 * Self-test (matches `cast keccak $(cast abi-encode ...)`):
 *   input:  roomKey   0x1111...1111 (32 bytes of 0x11)
 *           matchId   "m1"
 *           ids       ["p2", "p1"]        // join order; sorted to ["p1","p2"]
 *           winner    0x0000000000000000000000000000000000000001
 *   output: 0x7a3ed4255edce34f10f0300f9a94732bf45b5f50605c928f2dae496de0dfda61
 */
export function resultHash(input: ResultHashInput): Hex {
  const sorted = sortParticipantIds(input.participantIds);
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'bytes32' },
        { type: 'string' },
        { type: 'string[]' },
        { type: 'address' },
        { type: 'string' },
      ],
      [RESULT_PROTOCOL_TAG, input.roomKey, input.matchId, sorted, input.winner, RESULT_VERSION],
    ),
  );
}

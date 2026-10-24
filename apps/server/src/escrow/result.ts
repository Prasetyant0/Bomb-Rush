// The ONLY place a match result hash is produced for the wire.
//
// A hash exists only when all inputs exist:
//   - the room has a roomKey (a host wallet was supplied at creation), and
//   - the winner holds a wallet.
// Anything missing returns null. There is deliberately no placeholder value:
// a fake hash on the wire is indistinguishable from a real commitment.
import type { Hex } from 'viem';
import { resultHash } from '../chain/resultHash.js';
import type { RoomSession } from '../game/domain.js';

export interface MatchResultCommitment {
  hash: Hex;
  winnerWallet: `0x${string}`;
  participantIds: string[];
}

export type ResultCommitmentOutcome =
  | { ok: true; commitment: MatchResultCommitment }
  | { ok: false; reason: string };

export function buildResultCommitment(room: RoomSession): ResultCommitmentOutcome {
  if (room.roomKey == null) return { ok: false, reason: 'room has no roomKey (demo mode)' };
  if (room.matchId == null) return { ok: false, reason: 'room has no matchId' };
  if (room.winnerId == null) return { ok: false, reason: 'match has no winner' };
  const winner = room.participants.find((p) => p.participantId === room.winnerId);
  if (!winner) return { ok: false, reason: 'winner is not a participant' };
  if (winner.walletAddress == null) return { ok: false, reason: 'winner has no wallet address' };
  const participantIds = room.participants.map((p) => p.participantId);
  return {
    ok: true,
    commitment: {
      hash: resultHash({
        roomKey: room.roomKey as Hex,
        matchId: room.matchId,
        participantIds,
        winner: winner.walletAddress as `0x${string}`,
      }),
      winnerWallet: winner.walletAddress as `0x${string}`,
      participantIds,
    },
  };
}

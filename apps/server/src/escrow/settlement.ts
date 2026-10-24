// Post-match settlement: settle(roomKey, winner, hash) then payout(roomKey).
//
// Invariants:
//  - Off-chain result validity does NOT depend on the chain. A settle failure
//    is reported and the match result stands.
//  - "CONFIRMED" is only ever emitted after chain/escrow returned a txHash
//    backed by a successful receipt (ChainContext.write enforces that).
//  - A failed payout leaves the prize CLAIMABLE. We never report paid.
import type { Address, Hex } from 'viem';
import { payout, settle } from '../chain/escrow.js';

export type ChainStatusEvent =
  | { state: 'SETTLING' }
  | {
      state: 'CONFIRMED';
      txHash: string;
      payoutTxHash?: string;
      /** CLAIMABLE means the prize is on-chain claimable but not yet paid. */
      payoutState?: 'PAID' | 'CLAIMABLE';
      /** Present only when the payout leg failed; settlement itself stands. */
      reason?: string;
    }
  | { state: 'FAILED'; reason: string };

export interface SettlementChain {
  settle(roomKey: Hex, winner: Address, hash: Hex): Promise<{ txHash: Hex }>;
  payout(roomKey: Hex): Promise<{ txHash: Hex }>;
}

export const realSettlementChain: SettlementChain = {
  settle: async (roomKey, winner, hash) => ({ txHash: (await settle(roomKey, winner, hash)).txHash }),
  payout: async (roomKey) => ({ txHash: (await payout(roomKey)).txHash }),
};

export interface SettlementInput {
  roomKey: Hex;
  winner: Address;
  resultHash: Hex;
}

/**
 * Runs settle -> payout and reports every transition through `emit`.
 * Never throws: all failures become a FAILED status event.
 */
export async function settleMatch(
  input: SettlementInput,
  emit: (status: ChainStatusEvent) => void,
  chain: SettlementChain = realSettlementChain,
): Promise<ChainStatusEvent> {
  emit({ state: 'SETTLING' });
  let settleTx: Hex;
  try {
    settleTx = (await chain.settle(input.roomKey, input.winner, input.resultHash)).txHash;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const failed: ChainStatusEvent = { state: 'FAILED', reason: `settle: ${reason}` };
    emit(failed);
    return failed;
  }
  // settle succeeded: the escrow now records this winner + hash, and the prize
  // is claimable even if the payout below fails.
  emit({ state: 'CONFIRMED', txHash: settleTx, payoutState: 'CLAIMABLE' });

  try {
    const payoutTx = (await chain.payout(input.roomKey)).txHash;
    const paid: ChainStatusEvent = { state: 'CONFIRMED', txHash: settleTx, payoutTxHash: payoutTx, payoutState: 'PAID' };
    emit(paid);
    return paid;
  } catch (err) {
    // Do NOT mark paid and do NOT retract the confirmed settlement. The funds
    // are on-chain claimable by the winner; that is the honest state.
    const reason = err instanceof Error ? err.message : String(err);
    const claimable: ChainStatusEvent = {
      state: 'CONFIRMED',
      txHash: settleTx,
      payoutState: 'CLAIMABLE',
      reason: `payout: ${reason}`,
    };
    emit(claimable);
    return claimable;
  }
}

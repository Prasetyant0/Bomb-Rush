// Receipt verification (contracts/ABI_HANDOFF.md §3). A tx hash alone proves
// nothing: a reverted tx, another chain, another contract, another room, or a
// different deposit can all produce a valid-looking hash.
//
// Contract: a merely-invalid receipt returns {ok:false, reason}. Only an RPC
// failure (receipt/chainId unavailable) throws.
import { decodeEventLog, toEventSelector, type Address, type Hex, type Log, type TransactionReceipt } from 'viem';
import { ESCROW_ABI } from './abi.js';
import { getChainContext } from './client.js';
import { CHAIN_ID } from './config.js';

export type VerifyFailureReason =
  | 'RECEIPT_REVERTED'
  | 'WRONG_CHAIN'
  | 'NO_ESCROW_EVENT'
  | 'ROOM_KEY_MISMATCH'
  | 'PLAYER_MISMATCH'
  | 'AMOUNT_MISMATCH';

export interface VerifyExpected {
  roomKey: Hex;
  player: Address;
  amountWei: bigint;
  /** Escrow to trust. `verifyDeposit` fills this from config when omitted. */
  escrowAddress: Address;
  chainId?: number;
  /** Which event proves the deposit. createRoom emits both (handoff §3). */
  event?: 'DepositConfirmed' | 'RoomCreated';
}

export type VerifyResult =
  | { ok: true; txHash: Hex; logIndex: number; blockNumber: bigint; roomKey: Hex; player: Address; amountWei: bigint }
  | { ok: false; reason: VerifyFailureReason; detail: string };

/** Minimal slice of PublicClient that verification needs; fakeable in tests. */
export interface ReceiptReader {
  getChainId(): Promise<number>;
  getTransactionReceipt(args: { hash: Hex }): Promise<TransactionReceipt>;
}

const DEPOSIT_TOPIC = toEventSelector('DepositConfirmed(bytes32,address,uint256,uint8)');
const CREATED_TOPIC = toEventSelector('RoomCreated(bytes32,address,uint256,uint8,uint64,uint64)');

const eqAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function verifyTx(
  txHash: Hex,
  expected: VerifyExpected,
  reader: ReceiptReader = getChainContext().publicClient,
): Promise<VerifyResult> {
  const chainId = expected.chainId ?? CHAIN_ID;
  const receipt = await reader.getTransactionReceipt({ hash: txHash }); // RPC failure: propagate

  if (receipt.status !== 'success') {
    return { ok: false, reason: 'RECEIPT_REVERTED', detail: `receipt status is ${receipt.status}` };
  }
  // viem receipts carry no chainId, so the chain identity comes from eth_chainId.
  // Re-read it per verification: a proxy or failover can change what the URL serves.
  const actualChainId = await reader.getChainId(); // RPC failure: propagate
  if (actualChainId !== chainId) {
    return { ok: false, reason: 'WRONG_CHAIN', detail: `expected ${chainId}, got ${actualChainId}` };
  }

  const eventName = expected.event ?? 'DepositConfirmed';
  const topic = eventName === 'RoomCreated' ? CREATED_TOPIC : DEPOSIT_TOPIC;

  const logs = receipt.logs as Log[];
  const escrowLogs = logs.filter((log) => eqAddress(log.address, expected.escrowAddress));
  if (escrowLogs.length === 0) {
    return {
      ok: false,
      reason: 'NO_ESCROW_EVENT',
      detail: `no log from escrow ${expected.escrowAddress}`,
    };
  }

  const candidates = escrowLogs
    .filter((log) => log.topics[0]?.toLowerCase() === topic)
    .flatMap((log) => {
      try {
        return [{ log, decoded: decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics }) }];
      } catch {
        return []; // malformed log for this topic: not evidence of anything
      }
    })
    .filter((entry) => entry.decoded.eventName === eventName);

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'NO_ESCROW_EVENT',
      detail: `no ${eventName} log from escrow ${expected.escrowAddress}`,
    };
  }

  const roomMatches = candidates.filter(
    (entry) => ((entry.decoded.args as { roomKey: Hex }).roomKey ?? '').toLowerCase() === expected.roomKey.toLowerCase(),
  );
  if (roomMatches.length === 0) {
    return { ok: false, reason: 'ROOM_KEY_MISMATCH', detail: `${eventName} roomKey does not match` };
  }

  for (const { log, decoded } of roomMatches) {
    const args = decoded.args as { roomKey: Hex; amountWei?: bigint; entryWei?: bigint; player?: Address; host?: Address };
    const eventPlayer = (eventName === 'RoomCreated' ? args.host : args.player) as Address;
    const eventAmount = (eventName === 'RoomCreated' ? args.entryWei : args.amountWei) as bigint;

    if (!eqAddress(eventPlayer, expected.player)) {
      return { ok: false, reason: 'PLAYER_MISMATCH', detail: `expected ${expected.player}, got ${eventPlayer}` };
    }
    if (eventAmount !== expected.amountWei) {
      return { ok: false, reason: 'AMOUNT_MISMATCH', detail: `expected ${expected.amountWei} wei, got ${eventAmount} wei` };
    }
    return {
      ok: true,
      txHash,
      logIndex: log.logIndex ?? 0,
      blockNumber: log.blockNumber ?? receipt.blockNumber,
      roomKey: expected.roomKey,
      player: expected.player,
      amountWei: expected.amountWei,
    };
  }

  // Unreachable: every roomMatches entry returns above.
  return { ok: false, reason: 'ROOM_KEY_MISMATCH', detail: 'no matching deposit log' };
}

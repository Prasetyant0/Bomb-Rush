// Typed wrappers over TestnetPoolEscrow. Every wei amount is a bigint; JSON
// callers must stringify (see `roomPublicJson`). Nothing here invents a tx hash
// or reports success without a successful receipt — that happens in client.write.
import type { Address, Hex, TransactionReceipt } from 'viem';
import { ESCROW_ABI, EscrowStatus } from './abi.js';
import { getChainConfig, type ChainConfig } from './config.js';
import { getChainContext, type ChainContext } from './client.js';
import { verifyTx, type ReceiptReader, type VerifyExpected, type VerifyResult } from './receipt.js';

export type SettlementView = 'NONE' | 'CLAIMABLE' | 'PAID' | 'REFUNDABLE' | 'REFUNDED';

export interface RoomState {
  host: Address;
  maxSeats: number;
  depositCount: number;
  entryWei: bigint;
  potWei: bigint;
  /** UNIX seconds, not ms. */
  fundingDeadline: bigint;
  resolutionDeadline: bigint;
  status: EscrowStatus;
  winner: Address;
  resultHash: Hex;
  cancelReason: Hex;
  prizePaid: boolean;
}

export interface RefundCounts {
  depositors: number;
  withdrawn: number;
}

/** `getRoom` is a 12-field struct; a mismatch means the ABI drifted from this build. */
const ROOM_FIELD_COUNT = 12;

// viem returns named tuples as objects for this ABI. The array form is handled
// because a future ABI edit could flip it; both are indexed by the same order.
const ROOM_FIELDS = [
  'host', 'maxSeats', 'depositCount', 'entryWei', 'potWei', 'fundingDeadline',
  'resolutionDeadline', 'status', 'winner', 'resultHash', 'cancelReason', 'prizePaid',
] as const;

export function normalizeRoom(raw: unknown): RoomState {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ROOM_FIELDS.map((field) => (raw as Record<string, unknown>)[field])
      : null;

  if (!values || values.length !== ROOM_FIELD_COUNT) {
    throw new Error(`getRoom returned ${values?.length ?? 0} fields, expected ${ROOM_FIELD_COUNT}`);
  }
  const missing = ROOM_FIELDS.filter((_, i) => values[i] === undefined);
  if (missing.length > 0) {
    throw new Error(`getRoom is missing fields: ${missing.join(', ')}`);
  }

  const [host, maxSeats, depositCount, entryWei, potWei, fundingDeadline, resolutionDeadline, status, winner, resultHash, cancelReason, prizePaid] = values;

  return {
    host: host as Address,
    maxSeats: Number(maxSeats),
    depositCount: Number(depositCount),
    entryWei: BigInt(entryWei as bigint),
    potWei: BigInt(potWei as bigint),
    fundingDeadline: BigInt(fundingDeadline as bigint),
    resolutionDeadline: BigInt(resolutionDeadline as bigint),
    status: Number(status) as EscrowStatus,
    winner: winner as Address,
    resultHash: resultHash as Hex,
    cancelReason: cancelReason as Hex,
    prizePaid: Boolean(prizePaid),
  };
}

export function createRoomArgs(input: {
  roomKey: Hex;
  seats: number;
  entryWei: bigint;
  fundingDeadlineSec: bigint;
  resolutionDeadlineSec: bigint;
  /** Defaults to the configured escrow; pass explicitly to build args offline. */
  escrowAddress?: Address;
}) {
  const config = getChainConfig();
  const address = input.escrowAddress ?? (config.enabled ? config.escrowAddress : undefined);
  if (!address) throw new Error('createRoomArgs needs an escrow address: the chain module is disabled');
  return {
    address,
    abi: ESCROW_ABI,
    functionName: 'createRoom' as const,
    args: [input.roomKey, input.seats, input.entryWei, input.fundingDeadlineSec, input.resolutionDeadlineSec] as const,
    // createRoom is payable and the contract requires msg.value == entryWei.
    value: input.entryWei,
  };
}

export async function verifyDeposit(
  txHash: Hex,
  expected: Omit<VerifyExpected, 'escrowAddress'> & { escrowAddress?: Address },
  reader?: ReceiptReader,
): Promise<VerifyResult> {
  const config: ChainConfig = getChainConfig();
  const escrowAddress = expected.escrowAddress ?? (config.enabled ? config.escrowAddress : undefined);
  if (!escrowAddress) {
    throw new Error('Cannot verify a deposit while the chain module is disabled: no escrow address');
  }
  return verifyTx(txHash, { ...expected, escrowAddress }, reader ?? getChainContext().publicClient);
}

export async function getRoom(roomKey: Hex, ctx: ChainContext = getChainContext()): Promise<RoomState> {
  const raw = await ctx.publicClient.readContract({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'getRoom',
    args: [roomKey],
  });
  return normalizeRoom(raw);
}

export async function getRoomDepositors(roomKey: Hex, ctx: ChainContext = getChainContext()): Promise<Address[]> {
  return ctx.publicClient.readContract({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'getRoomDepositors',
    args: [roomKey],
  }) as Promise<Address[]>;
}

export async function entryBounds(ctx: ChainContext = getChainContext()): Promise<{ minWei: bigint; maxWei: bigint }> {
  const [minWei, maxWei] = (await ctx.publicClient.readContract({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'entryBounds',
  })) as readonly [bigint, bigint];
  return { minWei, maxWei };
}

export async function hasRole(role: Hex, account: Address, ctx: ChainContext = getChainContext()): Promise<boolean> {
  return ctx.publicClient.readContract({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'hasRole',
    args: [role, account],
  }) as Promise<boolean>;
}

export async function settlerRole(ctx: ChainContext = getChainContext()): Promise<Hex> {
  return ctx.publicClient.readContract({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'SETTLER_ROLE',
  }) as Promise<Hex>;
}

export async function hasSettlerRole(account: Address, ctx: ChainContext = getChainContext()): Promise<boolean> {
  return hasRole(await settlerRole(ctx), account, ctx);
}

/**
 * Startup self-check (ABI_HANDOFF §9): the RPC is on 10143 and the configured
 * key actually holds SETTLER_ROLE. Call before serving traffic; funded rooms
 * will fail at demo time otherwise.
 */
export async function selfCheck(ctx: ChainContext = getChainContext()): Promise<{ chainId: number; settlerAddress: Address; hasSettlerRole: boolean }> {
  const chainId = await ctx.assertChainId();
  const ok = await hasSettlerRole(ctx.settlerAddress, ctx);
  return { chainId, settlerAddress: ctx.settlerAddress, hasSettlerRole: ok };
}

/**
 * Pre-flight checks that the contract would otherwise revert on at demo time
 * (ABI_HANDOFF §8). Returns the room so the caller can freeze potWei before sending.
 */
async function assertSettleable(roomKey: Hex, winner: Address, hash: Hex, ctx: ChainContext): Promise<RoomState> {
  const room = await getRoom(roomKey, ctx);
  if (room.status !== EscrowStatus.FUNDED) {
    throw new Error(`Cannot settle: room status is ${EscrowStatus[room.status]}, expected FUNDED`);
  }
  if (room.depositCount !== room.maxSeats) {
    throw new Error(`Cannot settle: ${room.depositCount}/${room.maxSeats} seats funded`);
  }
  if (winner === '0x0000000000000000000000000000000000000000') throw new Error('Cannot settle: zero winner');
  if (/^0x0{64}$/.test(hash)) throw new Error('Cannot settle: zero result hash');
  const depositors = await getRoomDepositors(roomKey, ctx);
  if (!depositors.some((d) => d.toLowerCase() === winner.toLowerCase())) {
    throw new Error(`Cannot settle: winner ${winner} is not a depositor`);
  }
  return room;
}

export async function settle(
  roomKey: Hex,
  winner: Address,
  hash: Hex,
  ctx: ChainContext = getChainContext(),
): Promise<{ txHash: Hex; receipt: TransactionReceipt }> {
  await assertSettleable(roomKey, winner, hash, ctx);
  return ctx.write({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'settle',
    args: [roomKey, winner, hash],
  });
}

/** Permissionless: the recipient is the recorded winner, so anyone may trigger it. */
export async function payout(
  roomKey: Hex,
  ctx: ChainContext = getChainContext(),
): Promise<{ txHash: Hex; receipt: TransactionReceipt }> {
  return ctx.write({
    address: ctx.config.escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'payout',
    args: [roomKey],
  });
}

/**
 * ABI_HANDOFF §7. `FAILED` is deliberately absent: a failed payout leaves
 * SETTLED && !prizePaid — byte-identical to "never attempted" — so after a
 * restart it must read back as CLAIMABLE. The funds really are claimable.
 *
 * For CANCELED rooms, pass refund counts to distinguish REFUNDABLE from REFUNDED.
 * Without them the projection is REFUNDABLE, which is the safe default (there may
 * still be money to withdraw).
 */
export function projectSettlementView(
  room: Pick<RoomState, 'status' | 'prizePaid'>,
  refundCounts?: RefundCounts,
): SettlementView {
  switch (room.status) {
    case EscrowStatus.FUNDING:
    case EscrowStatus.FUNDED:
    case EscrowStatus.NONE:
      return 'NONE';
    case EscrowStatus.SETTLED:
      return room.prizePaid ? 'PAID' : 'CLAIMABLE';
    case EscrowStatus.CANCELED: {
      if (!refundCounts) return 'REFUNDABLE';
      return refundCounts.withdrawn >= refundCounts.depositors ? 'REFUNDED' : 'REFUNDABLE';
    }
    default:
      return 'NONE';
  }
}

/** JSON projection: wei stays exact as decimal strings, never Number. */
export function roomPublicJson(room: RoomState) {
  return {
    host: room.host,
    maxSeats: room.maxSeats,
    depositCount: room.depositCount,
    entryWei: room.entryWei.toString(),
    potWei: room.potWei.toString(),
    fundingDeadline: room.fundingDeadline.toString(),
    resolutionDeadline: room.resolutionDeadline.toString(),
    status: EscrowStatus[room.status] ?? 'NONE',
    winner: room.winner,
    resultHash: room.resultHash,
    cancelReason: room.cancelReason,
    prizePaid: room.prizePaid,
  };
}

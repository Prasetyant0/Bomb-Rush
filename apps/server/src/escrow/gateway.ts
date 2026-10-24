// Thin, injectable boundary over the chain module so routes can be tested
// without an RPC. The real implementation delegates to chain/ — it never
// invents a receipt or a tx hash.
import type { Address, Hex } from 'viem';
import { EscrowStatus } from '../chain/abi.js';
import { getChainConfig } from '../chain/config.js';
import { getRoom, entryBounds, verifyDeposit } from '../chain/escrow.js';
import type { VerifyResult } from '../chain/receipt.js';

export type RoomEscrowStatus = 'NONE' | 'FUNDING' | 'FUNDED' | 'SETTLED' | 'CANCELED';

export interface ChainRoomView {
  status: RoomEscrowStatus;
  entryWei: bigint;
  /** Host recorded by the contract; the roomKey's real owner. */
  host: string;
}

export interface DepositExpectation {
  roomKey: Hex;
  player: Address;
  amountWei: bigint;
}

export interface EscrowGateway {
  readonly enabled: boolean;
  /** Chain read. Unknown room keys come back as status NONE. */
  readRoom(roomKey: Hex): Promise<ChainRoomView>;
  /** Contract-enforced entry range. */
  entryBounds(): Promise<{ minWei: bigint; maxWei: bigint }>;
  /** All five receipt checks live in chain/receipt.ts; this only forwards. */
  verifyDeposit(txHash: Hex, expected: DepositExpectation): Promise<VerifyResult>;
}

export function escrowStatusName(status: EscrowStatus): RoomEscrowStatus {
  return (EscrowStatus[status] as RoomEscrowStatus | undefined) ?? 'NONE';
}

/** Real gateway. Only call when getChainConfig().enabled is true. */
export function chainGateway(): EscrowGateway {
  return {
    enabled: true,
    async readRoom(roomKey) {
      const room = await getRoom(roomKey);
      return { status: escrowStatusName(room.status), entryWei: room.entryWei, host: room.host };
    },
    entryBounds: () => entryBounds(),
    verifyDeposit(txHash, expected) {
      return verifyDeposit(txHash, expected);
    },
  };
}

/** Resolves the real gateway, or null when the chain module is disabled. */
export function defaultEscrowGateway(): EscrowGateway | null {
  return getChainConfig().enabled ? chainGateway() : null;
}

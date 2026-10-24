// Room identity bridge between a game room and the escrow contract.
//
// roomKey = keccak256(abi.encodePacked('BOMB_RUSH_V05', chainId, nonce, hostAddress))
//
// The contract cannot verify this derivation (it only sees a bytes32), so this
// module is the single source of truth: the same inputs must always produce the
// same key, and a room with no host wallet must never get a key at all.
import { encodePacked, isAddress, keccak256, type Address, type Hex } from 'viem';
import { randomBytes } from 'node:crypto';

export const ROOM_KEY_TAG = 'BOMB_RUSH_V05';

export interface RoomKeyInput {
  chainId: number | bigint;
  nonce: bigint;
  hostAddress: Address | string;
}

/** Pure and deterministic: same inputs -> same bytes32, on every process. */
export function deriveRoomKey(input: RoomKeyInput): Hex {
  const host = normalizeWallet(input.hostAddress);
  if (host === null) {
    throw new Error(`deriveRoomKey needs a valid host address, got "${input.hostAddress}"`);
  }
  if (input.nonce < 0n) throw new Error('deriveRoomKey nonce must be non-negative');
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'uint256', 'address'],
      [ROOM_KEY_TAG, BigInt(input.chainId), input.nonce, host as Address],
    ),
  );
}

/** 64-bit random nonce: unique per room without persisting a counter. */
export function generateRoomNonce(): bigint {
  return BigInt(`0x${randomBytes(8).toString('hex')}`);
}

/**
 * Wallet normalization for seats. Accepts an all-lowercase address, an
 * all-uppercase (0x-prefixed) address, or a correctly checksummed one, and
 * stores lowercase — the form every comparison uses. Returns null for anything
 * that is not a 20-byte hex address; callers reject, never silently drop.
 */
export function normalizeWallet(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  const upper = `0x${trimmed.slice(2).toUpperCase()}`;
  // isAddress (strict) validates EIP-55 checksums for mixed-case input.
  if (trimmed === lower || trimmed === upper || isAddress(trimmed)) return lower;
  return null;
}

// Maps TestnetPoolEscrow custom-error selectors to API error codes
// (contracts/ABI_HANDOFF.md §6). A revert carries no reason string, so the
// selector is the only thing the server can act on.
import { toFunctionSelector } from 'viem';
import { ESCROW_ABI } from './abi.js';

export type MappedRevert = { code: string; message: string; retryable: boolean };

// `retryable` means "the same call could succeed later without changing inputs".
// Only time-based reverts qualify; a state or value error will revert forever.
const BY_NAME: Record<string, MappedRevert> = {
  RoomExists: { code: 'ROOM_EXISTS', message: 'A room with this key already exists.', retryable: false },
  RoomMissing: { code: 'ROOM_NOT_FOUND', message: 'No escrow room exists for this key.', retryable: false },
  BadSeats: { code: 'BAD_REQUEST', message: 'Seats must be 3 or 4.', retryable: false },
  BadEntry: { code: 'INVALID_ENTRY_WEI', message: 'Entry amount is outside the contract bounds.', retryable: false },
  BadDeadlines: { code: 'BAD_REQUEST', message: 'Deadline is past, inverted, or beyond the contract cap.', retryable: false },
  // RoomNotFunding covers both "seats filled" and "funding window closed".
  // RoomFull is its own error, so LOBBY_LOCKED is the more specific code here.
  RoomNotFunding: { code: 'LOBBY_LOCKED', message: 'Room is no longer accepting deposits.', retryable: false },
  DeadlinePassed: { code: 'ROOM_EXPIRED', message: 'The funding or resolution deadline has passed.', retryable: false },
  DeadlineNotPassed: { code: 'BAD_STATE', message: 'The deadline has not passed yet.', retryable: true },
  WrongValue: { code: 'INVALID_ENTRY_WEI', message: 'Sent value does not equal the room entry amount.', retryable: false },
  AlreadyDeposited: { code: 'ALREADY_FUNDED', message: 'This wallet already funded the room.', retryable: false },
  RoomFull: { code: 'ROOM_FULL', message: 'All seats are taken.', retryable: false },
  NotFunded: { code: 'BAD_STATE', message: 'Room is not fully funded.', retryable: false },
  NotSettled: { code: 'BAD_STATE', message: 'Room has not been settled.', retryable: false },
  WinnerNotDepositor: { code: 'TX_REVERTED', message: 'Winner is not a depositor of this room.', retryable: false },
  ZeroWinner: { code: 'BAD_REQUEST', message: 'Winner address is zero.', retryable: false },
  ZeroResultHash: { code: 'BAD_REQUEST', message: 'Result hash is zero.', retryable: false },
  ZeroRoomKey: { code: 'BAD_REQUEST', message: 'Room key is zero.', retryable: false },
  AlreadySettled: { code: 'TX_REVERTED', message: 'Room is already settled.', retryable: false },
  AlreadyCanceled: { code: 'MATCH_CANCELED', message: 'Room is already canceled.', retryable: false },
  NotCancelable: { code: 'REFUND_NOT_AVAILABLE', message: 'Room state does not allow cancel or refund.', retryable: false },
  PrizeAlreadyPaid: { code: 'TX_REVERTED', message: 'Prize was already paid.', retryable: false },
  NotDepositor: { code: 'NOT_AUTHORIZED', message: 'Caller is not a depositor of this room.', retryable: false },
  RefundAlreadyWithdrawn: { code: 'TX_REVERTED', message: 'Refund was already withdrawn.', retryable: false },
  TransferFailed: { code: 'TX_REVERTED', message: 'MON transfer to the recipient failed.', retryable: false },
  // Declared by the contract but superseded by AccessControl reverts in practice.
  NotSettler: { code: 'NOT_AUTHORIZED', message: 'Caller does not hold SETTLER_ROLE.', retryable: false },
  NotAdmin: { code: 'NOT_AUTHORIZED', message: 'Caller does not hold DEFAULT_ADMIN_ROLE.', retryable: false },
  AccessControlUnauthorizedAccount: { code: 'NOT_AUTHORIZED', message: 'Caller is missing the required role.', retryable: false },
  AccessControlBadConfirmation: { code: 'NOT_AUTHORIZED', message: 'Role change was not confirmed by the account.', retryable: false },
  ReentrancyGuardReentrantCall: { code: 'TX_REVERTED', message: 'Reentrant call rejected.', retryable: false },
};

/** selector (`0x` + 8 hex chars) -> mapped code, built from the ABI, not hardcoded. */
export const REVERT_SELECTORS: Readonly<Record<string, MappedRevert>> = Object.fromEntries(
  ESCROW_ABI.filter((e) => e.type === 'error').map((e) => [
    toFunctionSelector(`${e.name}(${e.inputs.map((i) => i.type).join(',')})`),
    BY_NAME[e.name] ?? { code: 'TX_REVERTED', message: e.name, retryable: false },
  ]),
);

const UNKNOWN: MappedRevert = {
  code: 'TX_REVERTED',
  message: 'Transaction reverted with an unmapped error.',
  retryable: false,
};

const SELECTOR_RE = /^0x[0-9a-fA-F]{8}/;

/** Walks the error/cause chain for a decoded error name or revert data. viem nests these. */
function lookup(err: unknown, depth = 0): MappedRevert | undefined {
  if (err == null || depth > 5) return undefined;
  if (typeof err === 'string') {
    return SELECTOR_RE.test(err) ? REVERT_SELECTORS[err.slice(0, 10).toLowerCase()] : undefined;
  }
  if (typeof err !== 'object') return undefined;

  const e = err as Record<string, unknown>;
  // ContractFunctionRevertedError carries the decoded ABI error name when the
  // abi we sent includes it; `raw` is the fallback for anything we did not declare
  // (notably OpenZeppelin AccessControl errors, which the contract inherits).
  if (typeof e.errorName === 'string' && BY_NAME[e.errorName]) return BY_NAME[e.errorName];
  for (const key of ['raw', 'data', 'revertData']) {
    const value = e[key];
    if (typeof value === 'string' && SELECTOR_RE.test(value)) {
      const mapped = REVERT_SELECTORS[value.slice(0, 10).toLowerCase()];
      if (mapped) return mapped;
    }
  }
  return lookup(e.cause, depth + 1);
}

export function mapRevert(err: unknown): MappedRevert {
  return { ...(lookup(err) ?? UNKNOWN) };
}

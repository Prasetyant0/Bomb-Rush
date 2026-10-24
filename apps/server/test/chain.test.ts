// Chain module tests — no live chain. Receipts are encoded fixtures.
import { describe, it, expect } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  toEventSelector,
  toFunctionSelector,
  type Hex,
} from 'viem';
import { ESCROW_ABI, EscrowStatus } from '../src/chain/abi.js';
import { readConfig, resetChainConfig, getChainConfig } from '../src/chain/config.js';
import { getChainContext, resetChainContext, ChainDisabledError } from '../src/chain/client.js';
import { mapRevert, REVERT_SELECTORS } from '../src/chain/errors.js';
import { resultHash, sortParticipantIds } from '../src/chain/resultHash.js';
import { verifyTx, type ReceiptReader } from '../src/chain/receipt.js';
import { normalizeRoom, projectSettlementView, roomPublicJson } from '../src/chain/escrow.js';

const ESCROW = '0x00000000000000000000000000000000000000E5' as const;
const ROOM_KEY = `0x${'11'.repeat(32)}` as Hex;
const OTHER_KEY = `0x${'22'.repeat(32)}` as Hex;
const PLAYER = '0x00000000000000000000000000000000000000A1' as const;
const OTHER_PLAYER = '0x00000000000000000000000000000000000000A2' as const;
const TX = `0x${'ab'.repeat(32)}` as Hex;

function depositLog(opts: {
  roomKey?: Hex;
  player?: `0x${string}`;
  amountWei?: bigint;
  address?: `0x${string}`;
  count?: number;
} = {}) {
  const player = opts.player ?? PLAYER;
  const roomKey = opts.roomKey ?? ROOM_KEY;
  const topics = encodeEventTopics({
    abi: ESCROW_ABI,
    eventName: 'DepositConfirmed',
    args: { roomKey, player },
  });
  return {
    address: opts.address ?? ESCROW,
    topics,
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint8' }],
      [opts.amountWei ?? 500n, opts.count ?? 2],
    ),
    blockNumber: 42n,
    logIndex: 1,
    transactionHash: TX,
    transactionIndex: 0,
    blockHash: `0x${'00'.repeat(32)}`,
    removed: false,
  };
}

function receipt(status: 'success' | 'reverted', logs: unknown[]) {
  return {
    status,
    logs,
    blockNumber: 42n,
    transactionHash: TX,
  } as never;
}

function reader(opts: { chainId?: number; receipt: never; throwOnChainId?: boolean }): ReceiptReader {
  return {
    async getChainId() {
      if (opts.throwOnChainId) throw new Error('rpc down');
      return opts.chainId ?? 10_143;
    },
    async getTransactionReceipt() {
      return opts.receipt;
    },
  };
}

const expected = { roomKey: ROOM_KEY, player: PLAYER, amountWei: 500n, escrowAddress: ESCROW };

describe('resultHash', () => {
  const base = { roomKey: ROOM_KEY, matchId: 'm1', participantIds: ['p1', 'p2'], winner: '0x0000000000000000000000000000000000000001' as const };

  it('matches the cast-derived golden value', () => {
    expect(resultHash({ ...base, participantIds: ['p2', 'p1'] })).toBe(
      '0x7a3ed4255edce34f10f0300f9a94732bf45b5f50605c928f2dae496de0dfda61',
    );
  });

  it('is deterministic', () => {
    expect(resultHash(base)).toBe(resultHash(base));
  });

  it('is independent of join order (lexicographic sort, not input order)', () => {
    const shuffled = ['z9', 'a1', 'm5', 'b2'];
    expect(resultHash({ ...base, participantIds: shuffled })).toBe(
      resultHash({ ...base, participantIds: [...shuffled].sort() }),
    );
  });

  it('sorts lexicographically rather than numerically', () => {
    // numeric sort would give ['2','10']; lexicographic gives ['10','2']
    expect(sortParticipantIds(['2', '10'])).toEqual(['10', '2']);
    expect(sortParticipantIds(['p10', 'p2', 'p1'])).toEqual(['p1', 'p10', 'p2']);
  });

  it('does not mutate the caller input array', () => {
    const ids = ['c', 'a', 'b'];
    resultHash({ ...base, participantIds: ids });
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('changes when the winner changes', () => {
    expect(resultHash(base)).not.toBe(
      resultHash({ ...base, winner: '0x0000000000000000000000000000000000000002' }),
    );
  });
});

describe('mapRevert', () => {
  const cases: Array<[string, string]> = [
    ['RoomExists()', 'ROOM_EXISTS'],
    ['RoomMissing()', 'ROOM_NOT_FOUND'],
    ['BadSeats()', 'BAD_REQUEST'],
    ['BadEntry()', 'INVALID_ENTRY_WEI'],
    ['BadDeadlines()', 'BAD_REQUEST'],
    ['RoomNotFunding()', 'LOBBY_LOCKED'],
    ['DeadlinePassed()', 'ROOM_EXPIRED'],
    ['DeadlineNotPassed()', 'BAD_STATE'],
    ['WrongValue()', 'INVALID_ENTRY_WEI'],
    ['AlreadyDeposited()', 'ALREADY_FUNDED'],
    ['RoomFull()', 'ROOM_FULL'],
    ['NotFunded()', 'BAD_STATE'],
    ['WinnerNotDepositor()', 'TX_REVERTED'],
    ['ZeroWinner()', 'BAD_REQUEST'],
    ['ZeroResultHash()', 'BAD_REQUEST'],
    ['ZeroRoomKey()', 'BAD_REQUEST'],
    ['AlreadySettled()', 'TX_REVERTED'],
    ['AlreadyCanceled()', 'MATCH_CANCELED'],
    ['NotCancelable()', 'REFUND_NOT_AVAILABLE'],
    ['PrizeAlreadyPaid()', 'TX_REVERTED'],
    ['NotDepositor()', 'NOT_AUTHORIZED'],
    ['RefundAlreadyWithdrawn()', 'TX_REVERTED'],
    ['TransferFailed()', 'TX_REVERTED'],
    ['AccessControlUnauthorizedAccount(address,bytes32)', 'NOT_AUTHORIZED'],
  ];

  for (const [signature, code] of cases) {
    it(`maps ${signature} to ${code}`, () => {
      const selector = toFunctionSelector(signature);
      expect(REVERT_SELECTORS[selector]?.code).toBe(code);
      expect(mapRevert({ raw: `${selector}${'00'.repeat(32)}` }).code).toBe(code);
    });
  }

  it('every contract error has a selector mapping', () => {
    const errors = ESCROW_ABI.filter((e) => e.type === 'error');
    for (const e of errors) {
      const signature = `${e.name}(${e.inputs.map((i) => i.type).join(',')})`;
      expect(REVERT_SELECTORS[toFunctionSelector(signature)], e.name).toBeDefined();
    }
  });

  it('unwraps viem nested cause chain', () => {
    const selector = toFunctionSelector('RoomFull()');
    const err = { name: 'ContractFunctionExecutionError', cause: { cause: { data: `0x${selector.slice(2)}` } } };
    expect(mapRevert(err)).toMatchObject({ code: 'ROOM_FULL', retryable: false });
  });

  it('decodes a viem errorName when present', () => {
    expect(mapRevert({ errorName: 'PrizeAlreadyPaid' })).toMatchObject({ code: 'TX_REVERTED' });
  });

  it('falls back to TX_REVERTED for unknown data', () => {
    expect(mapRevert({ raw: '0xdeadbeef' })).toEqual({
      code: 'TX_REVERTED',
      message: 'Transaction reverted with an unmapped error.',
      retryable: false,
    });
    expect(mapRevert(new Error('boom')).code).toBe('TX_REVERTED');
  });
});

describe('verifyTx', () => {
  it('accepts a matching DepositConfirmed log', async () => {
    const res = await verifyTx(TX, expected, reader({ receipt: receipt('success', [depositLog()]) }));
    expect(res).toMatchObject({ ok: true, txHash: TX, roomKey: ROOM_KEY, player: PLAYER, amountWei: 500n, logIndex: 1 });
  });

  it('rejects a reverted receipt', async () => {
    const res = await verifyTx(TX, expected, reader({ receipt: receipt('reverted', [depositLog()]) }));
    expect(res).toMatchObject({ ok: false, reason: 'RECEIPT_REVERTED' });
  });

  it('rejects the wrong chain', async () => {
    const res = await verifyTx(TX, expected, reader({ chainId: 1, receipt: receipt('success', [depositLog()]) }));
    expect(res).toMatchObject({ ok: false, reason: 'WRONG_CHAIN' });
  });

  it('rejects a log from another contract', async () => {
    const res = await verifyTx(
      TX,
      expected,
      reader({ receipt: receipt('success', [depositLog({ address: OTHER_PLAYER })]) }),
    );
    expect(res).toMatchObject({ ok: false, reason: 'NO_ESCROW_EVENT' });
  });

  it('rejects a receipt with only unrelated escrow events', async () => {
    const res = await verifyTx(
      TX,
      expected,
      reader({
        receipt: receipt('success', [
          { ...depositLog(), topics: [toEventSelector('RoomFunded(bytes32)'), ROOM_KEY] },
        ]),
      }),
    );
    expect(res).toMatchObject({ ok: false, reason: 'NO_ESCROW_EVENT' });
  });

  it('rejects a different roomKey', async () => {
    const res = await verifyTx(TX, expected, reader({ receipt: receipt('success', [depositLog({ roomKey: OTHER_KEY })]) }));
    expect(res).toMatchObject({ ok: false, reason: 'ROOM_KEY_MISMATCH' });
  });

  it('rejects a different player', async () => {
    const res = await verifyTx(TX, expected, reader({ receipt: receipt('success', [depositLog({ player: OTHER_PLAYER })]) }));
    expect(res).toMatchObject({ ok: false, reason: 'PLAYER_MISMATCH' });
  });

  it('rejects a different amount', async () => {
    const res = await verifyTx(TX, expected, reader({ receipt: receipt('success', [depositLog({ amountWei: 499n })]) }));
    expect(res).toMatchObject({ ok: false, reason: 'AMOUNT_MISMATCH' });
  });

  it('does not accept a RoomCreated log as a DepositConfirmed proof by default', async () => {
    const topics = encodeEventTopics({
      abi: ESCROW_ABI,
      eventName: 'RoomCreated',
      args: { roomKey: ROOM_KEY, host: PLAYER },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint64' }, { type: 'uint64' }],
      [500n, 4, 1000n, 2000n],
    );
    const log = { ...depositLog(), topics, data };
    const res = await verifyTx(TX, expected, reader({ receipt: receipt('success', [log]) }));
    expect(res).toMatchObject({ ok: false, reason: 'NO_ESCROW_EVENT' });
  });

  it('accepts RoomCreated when explicitly requested (createRoom emits both)', async () => {
    const topics = encodeEventTopics({
      abi: ESCROW_ABI,
      eventName: 'RoomCreated',
      args: { roomKey: ROOM_KEY, host: PLAYER },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint64' }, { type: 'uint64' }],
      [500n, 4, 1000n, 2000n],
    );
    const log = { ...depositLog(), topics, data };
    const res = await verifyTx(TX, { ...expected, event: 'RoomCreated' }, reader({ receipt: receipt('success', [log]) }));
    expect(res).toMatchObject({ ok: true, roomKey: ROOM_KEY, player: PLAYER, amountWei: 500n });
  });

  it('propagates RPC failure instead of returning invalid', async () => {
    await expect(
      verifyTx(TX, expected, reader({ throwOnChainId: true, receipt: receipt('success', [depositLog()]) })),
    ).rejects.toThrow('rpc down');
  });
});

describe('projectSettlementView', () => {
  it('NONE -> NONE', () => {
    expect(projectSettlementView({ status: EscrowStatus.NONE, prizePaid: false })).toBe('NONE');
  });
  it('FUNDING -> NONE', () => {
    expect(projectSettlementView({ status: EscrowStatus.FUNDING, prizePaid: false })).toBe('NONE');
  });
  it('FUNDED -> NONE', () => {
    expect(projectSettlementView({ status: EscrowStatus.FUNDED, prizePaid: false })).toBe('NONE');
  });
  it('SETTLED + unpaid -> CLAIMABLE (failed payout is indistinguishable)', () => {
    expect(projectSettlementView({ status: EscrowStatus.SETTLED, prizePaid: false })).toBe('CLAIMABLE');
  });
  it('SETTLED + paid -> PAID', () => {
    expect(projectSettlementView({ status: EscrowStatus.SETTLED, prizePaid: true })).toBe('PAID');
  });
  it('CANCELED with refunds outstanding -> REFUNDABLE', () => {
    expect(projectSettlementView({ status: EscrowStatus.CANCELED, prizePaid: false }, { depositors: 4, withdrawn: 3 })).toBe('REFUNDABLE');
  });
  it('CANCELED with no counts -> REFUNDABLE (safe default)', () => {
    expect(projectSettlementView({ status: EscrowStatus.CANCELED, prizePaid: false })).toBe('REFUNDABLE');
  });
  it('CANCELED with all refunded -> REFUNDED', () => {
    expect(projectSettlementView({ status: EscrowStatus.CANCELED, prizePaid: false }, { depositors: 4, withdrawn: 4 })).toBe('REFUNDED');
  });
  it('never returns FAILED', () => {
    for (const status of [EscrowStatus.NONE, EscrowStatus.FUNDING, EscrowStatus.FUNDED, EscrowStatus.SETTLED, EscrowStatus.CANCELED]) {
      for (const prizePaid of [false, true]) {
        expect(projectSettlementView({ status, prizePaid })).not.toBe('FAILED');
      }
    }
  });
});

describe('normalizeRoom', () => {
  const values = [
    PLAYER, 4, 2, 10n, 20n, 100n, 200n, EscrowStatus.FUNDED,
    '0x0000000000000000000000000000000000000000', `0x${'ab'.repeat(32)}`, `0x${'00'.repeat(32)}`, false,
  ];
  const named = Object.fromEntries(
    ['host', 'maxSeats', 'depositCount', 'entryWei', 'potWei', 'fundingDeadline', 'resolutionDeadline', 'status', 'winner', 'resultHash', 'cancelReason', 'prizePaid']
      .map((k, i) => [k, values[i]]),
  );

  it('accepts the named-object form', () => {
    expect(normalizeRoom(named)).toMatchObject({ host: PLAYER, entryWei: 10n, potWei: 20n, status: EscrowStatus.FUNDED, prizePaid: false });
  });

  it('accepts the array form', () => {
    expect(normalizeRoom(values)).toEqual(normalizeRoom(named));
  });

  it('asserts the 12-field count', () => {
    expect(() => normalizeRoom(values.slice(0, 11))).toThrow(/11 fields, expected 12/);
  });

  it('rejects a named object with a missing field', () => {
    expect(() => normalizeRoom({ ...named, prizePaid: undefined })).toThrow(/missing fields: prizePaid/);
  });

  it('keeps wei as bigint and stringifies for JSON', () => {
    const room = normalizeRoom(named);
    const json = roomPublicJson(room);
    expect(typeof room.entryWei).toBe('bigint');
    expect(json.entryWei).toBe('10');
    expect(json.potWei).toBe('20');
    expect(json.status).toBe('FUNDED');
  });
});

describe('config disabled path', () => {
  it('disables when both escrow address and key are absent', () => {
    const config = readConfig({});
    expect(config).toMatchObject({ enabled: false, chainId: 10_143 });
    expect(config.enabled === false && config.reason).toContain('SERVER_SETTLER_PRIVATE_KEY');
  });

  it('disables when only the address is present', () => {
    const config = readConfig({ ESCROW_ADDRESS: ESCROW });
    expect(config.enabled).toBe(false);
    expect(config.enabled === false && config.reason).toBe('SERVER_SETTLER_PRIVATE_KEY is unset');
  });

  it('disables when only the key is present', () => {
    const config = readConfig({ SERVER_SETTLER_PRIVATE_KEY: `0x${'11'.repeat(32)}` });
    expect(config.enabled).toBe(false);
    expect(config.enabled === false && config.reason).toBe('ESCROW_ADDRESS is unset');
  });

  it('throws on a malformed address rather than silently disabling', () => {
    expect(() => readConfig({ ESCROW_ADDRESS: 'nope', SERVER_SETTLER_PRIVATE_KEY: `0x${'11'.repeat(32)}` })).toThrow(/ESCROW_ADDRESS/);
  });

  it('requires an RPC URL when enabled', () => {
    expect(() =>
      readConfig({ ESCROW_ADDRESS: ESCROW, SERVER_SETTLER_PRIVATE_KEY: `0x${'11'.repeat(32)}` }),
    ).toThrow(/MONAD_RPC_URL/);
  });

  it('parses the enabled config with deployment block', () => {
    const config = readConfig({
      ESCROW_ADDRESS: ESCROW,
      SERVER_SETTLER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      MONAD_RPC_URL: 'http://127.0.0.1:8545',
      ESCROW_DEPLOYMENT_BLOCK: '123',
    });
    expect(config).toMatchObject({
      enabled: true,
      escrowAddress: ESCROW,
      rpcUrl: 'http://127.0.0.1:8545',
      deploymentBlock: 123n,
      chainId: 10_143,
    });
  });

  it('getChainContext throws ChainDisabledError in disabled mode', () => {
    const saved = { ...process.env };
    try {
      delete process.env.ESCROW_ADDRESS;
      delete process.env.SERVER_SETTLER_PRIVATE_KEY;
      resetChainConfig();
      resetChainContext();
      expect(getChainConfig().enabled).toBe(false);
      expect(() => getChainContext()).toThrow(ChainDisabledError);
    } finally {
      process.env = saved;
      resetChainConfig();
      resetChainContext();
    }
  });

  it('ChainDisabledError carries the API code', () => {
    expect(new ChainDisabledError('x').code).toBe('CHAIN_DISABLED');
  });
});

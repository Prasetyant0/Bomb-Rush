// viem clients for Monad Testnet (chainId 10143).
// Every write goes through `ChainContext.write`, which re-reads eth_chainId
// immediately before sending and waits for a receipt before reporting success.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, getChainConfig, type ChainConfig, type ChainConfigEnabled } from './config.js';

// viem ships monadTestnet, but defining it here keeps the id/RPC pairing
// explicit and version-independent. The RPC URL still comes from env.
export const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Testnet MON Token', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Testnet explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

export class ChainDisabledError extends Error {
  readonly code = 'CHAIN_DISABLED';
  constructor(reason: string) {
    super(`Chain module is disabled: ${reason}`);
    this.name = 'ChainDisabledError';
  }
}

export class WrongChainError extends Error {
  readonly code = 'WRONG_CHAIN';
  constructor(readonly expected: number, readonly actual: number) {
    super(`Refusing to write: expected chainId ${expected}, RPC reports ${actual}`);
    this.name = 'WrongChainError';
  }
}

export class ChainTxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ChainTxError';
  }
}

export interface ChainWriteRequest {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface ChainContext {
  readonly config: ChainConfigEnabled;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly settlerAddress: Address;
  /** Reads eth_chainId and throws WrongChainError unless it is 10143. */
  assertChainId(): Promise<number>;
  /** Enforces chainId, sends, waits for a receipt, and throws if it reverted. */
  write(request: ChainWriteRequest): Promise<{ txHash: Hex; receipt: TransactionReceipt }>;
}

export function createChainContext(config: ChainConfigEnabled): ChainContext {
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(config.rpcUrl) });
  const account = privateKeyToAccount(config.settlerPrivateKey);
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(config.rpcUrl) });

  const assertChainId = async (): Promise<number> => {
    const actual = await publicClient.getChainId();
    if (actual !== CHAIN_ID) throw new WrongChainError(CHAIN_ID, actual);
    return actual;
  };

  return {
    config,
    publicClient,
    walletClient,
    settlerAddress: account.address,
    assertChainId,
    async write(request) {
      await assertChainId();
      const txHash = await walletClient.writeContract({
        ...request,
        abi: request.abi as never,
        account,
        chain: monadTestnet,
      } as never);
      // Never report a write as done without a successful receipt.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        throw new ChainTxError('TX_REVERTED', `Transaction ${txHash} reverted`);
      }
      return { txHash, receipt };
    },
  };
}

let cached: { config: ChainConfigEnabled; context: ChainContext } | null = null;

/** Process-wide context. Throws ChainDisabledError when env is incomplete. */
export function getChainContext(config: ChainConfig = getChainConfig()): ChainContext {
  if (!config.enabled) throw new ChainDisabledError(config.reason);
  if (cached?.config !== config) cached = { config, context: createChainContext(config) };
  return cached.context;
}

/** Test hook: drop the memoized context. */
export function resetChainContext(): void {
  cached = null;
}

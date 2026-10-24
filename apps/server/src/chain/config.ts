// Chain configuration, read once from env at module load.
// Missing escrow address or settler key degrades to `disabled` so the game
// still boots with no chain (hackathon demo fallback). A malformed value is a
// hard error: silently disabling on a typo would hide a real misconfiguration
// until settlement time.
import { isAddress, isHex } from 'viem';

export const CHAIN_ID = 10_143; // Monad Testnet only (contracts/README.md)

export interface ChainConfigEnabled {
  enabled: true;
  chainId: typeof CHAIN_ID;
  rpcUrl: string;
  escrowAddress: `0x${string}`;
  /** First block to scan for escrow logs; null means scan from the RPC's earliest. */
  deploymentBlock: bigint | null;
  settlerPrivateKey: `0x${string}`;
}

export interface ChainConfigDisabled {
  enabled: false;
  chainId: typeof CHAIN_ID;
  /** Why the module is disabled — surfaced at boot for the demo operator. */
  reason: string;
}

export type ChainConfig = ChainConfigEnabled | ChainConfigDisabled;

type Env = Record<string, string | undefined>;

function parseDeploymentBlock(raw: string | undefined): bigint | null {
  if (raw === undefined || raw.trim() === '') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`ESCROW_DEPLOYMENT_BLOCK must be a non-negative integer, got "${raw}"`);
  }
  return BigInt(trimmed);
}

export function readConfig(env: Env = process.env): ChainConfig {
  const addressRaw = env.ESCROW_ADDRESS?.trim() ?? '';
  const keyRaw = env.SERVER_SETTLER_PRIVATE_KEY?.trim() ?? '';

  if (addressRaw === '' && keyRaw === '') {
    return { enabled: false, chainId: CHAIN_ID, reason: 'ESCROW_ADDRESS and SERVER_SETTLER_PRIVATE_KEY are unset' };
  }
  if (addressRaw === '') {
    return { enabled: false, chainId: CHAIN_ID, reason: 'ESCROW_ADDRESS is unset' };
  }
  if (keyRaw === '') {
    return { enabled: false, chainId: CHAIN_ID, reason: 'SERVER_SETTLER_PRIVATE_KEY is unset' };
  }

  if (!isAddress(addressRaw)) {
    throw new Error(`ESCROW_ADDRESS is not a valid address: "${addressRaw}"`);
  }
  if (!isHex(keyRaw, { strict: true }) || keyRaw.length !== 66) {
    throw new Error('SERVER_SETTLER_PRIVATE_KEY must be a 32-byte 0x-prefixed hex string');
  }

  const rpcUrl = env.MONAD_RPC_URL?.trim() ?? '';
  if (rpcUrl === '') {
    throw new Error('MONAD_RPC_URL is required when the chain module is enabled');
  }

  return {
    enabled: true,
    chainId: CHAIN_ID,
    rpcUrl,
    escrowAddress: addressRaw as `0x${string}`,
    deploymentBlock: parseDeploymentBlock(env.ESCROW_DEPLOYMENT_BLOCK),
    settlerPrivateKey: keyRaw as `0x${string}`,
  };
}

let memoized: ChainConfig | null = null;

/** Memoized readConfig(process.env), so the context and config stay paired. */
export function getChainConfig(): ChainConfig {
  memoized ??= readConfig();
  return memoized;
}

/** Test hook: re-read process.env on the next getChainConfig(). */
export function resetChainConfig(): void {
  memoized = null;
}

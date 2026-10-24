// Chain module: Monad Testnet escrow wiring (contracts/ABI_HANDOFF.md).
//
// Degrades to an explicit `disabled` state when ESCROW_ADDRESS or
// SERVER_SETTLER_PRIVATE_KEY is unset, so the game boots with no chain.
export * from './abi.js';
export * from './config.js';
export * from './client.js';
export * from './errors.js';
export * from './escrow.js';
export * from './receipt.js';
export * from './resultHash.js';

import { getChainConfig } from './config.js';

/** Startup log line: exactly what the chain layer will (not) do this run. */
export function chainStatus(): { enabled: boolean; detail: string } {
  const config = getChainConfig();
  return config.enabled
    ? { enabled: true, detail: `escrow ${config.escrowAddress} on chain ${config.chainId}` }
    : { enabled: false, detail: config.reason };
}

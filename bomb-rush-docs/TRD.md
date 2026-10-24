# TRD — Technical Requirements v0.5

## Stack / packages
| Domain | Technology | Owner |
|---|---|---|
| Web UI | React + TypeScript + Vite + Tailwind | C |
| 3D | three + `@react-three/fiber` + drei + low-poly GLB | A |
| Multiplayer | Node.js TypeScript + Fastify + Socket.IO | B |
| Game shared types | `packages/shared` with zod schemas, constants, `game-protocol/0.5` | B / all |
| Wallet | wagmi + viem + injected/WalletConnect mobile-capable connector | C |
| Smart contract | Solidity ^0.8.x + audited role-control + ReentrancyGuard from established libraries | C |
| Contract tests | Foundry or Hardhat, fuzz/property tests required | C + reviewer |
| State | in-memory map for sessions; on-chain escrow state from contract | B |
| Hosting | one HTTPS/WSS origin; persistent secret env; stable signer | B+C |

## Repo skeleton
```text
apps/
  web/src/{pages,game,input,ui,web3,net}/
  server/src/{api,rooms,simulation,sockets,chain,auth}/
packages/shared/src/{constants,types,schemas,errors}/
contracts/{src,script,test}/
docs/ (these 21 files)
```

## Chain configuration (strict validation)
```env
VITE_CHAIN_ID=10143
VITE_ESCROW_ADDRESS=<deployed_testnet_contract_address>
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
SERVER_CHAIN_ID=10143
SERVER_SETTLER_PRIVATE_KEY=<SECRET_SERVER_ENV_ONLY>
ESCROW_DEPLOYMENT_BLOCK=<ACTUAL_BLOCK>
EXPLORER_TX_BASE=<VERIFIED_TESTNET_EXPLORER_TX_URL_PREFIX>
```
Never provide private keys in demo repo, frontend, browser local storage, logs, CI output, screenshots, or git history. Use fresh testnet-only keys. Validate `eth_chainId` before every write. Browser wallet must prompt clearly if wrong network. Avoid hardcoding one explorer provider without verification.

## Implementation rules
- Use `parseEther(string)` to convert a strictly validated amount in MON to `bigint` wei; format only for display with `formatEther`. Reject scientific notation, negative, zero, excessive precision, NaN, commas, and non-string JSON amounts. Define supported min/max via wallet UX (v0.5 fixed range `0.001`–`0.01` test MON, enforced by contract and backend).
- All wire `entryWei` and `potWei` decimal strings, never JS `number` in arithmetic. Chain fees are additional wallet expense; amount contributed is exactly msg.value.
- Deploy and test contract before funding UI wiring. Contract must enforce exact value, member uniqueness, timeouts, admin roles and value accounting.
- Frontend never produces `funded=true` without server verifying chain data. Every UI transaction has statuses `AWAITING_WALLET/SUBMITTED/CONFIRMED/FAILED` and explicit retry/recovery.
- No on-chain movement or bomb transfers. 20Hz authoritative sim; 15Hz interpolated snapshots; 30 inputs/s max; RAF-driven client rendering, no React re-render on every physics tick.
- Mobile browser safe areas, DPR cap (1–1.5 low-end, ≤2 desktop), simple shadows and GLB under total 10MB. Target desktop 60 fps, mobile ≥30 fps.

## Contract implementation guidance
- Final ABI is specified in `SMART_CONTRACT_SPEC.md`. Use narrowly scoped roles and constructor-admin, unique room keys, fixed deadlines, check-effects-interactions and reentrancy guard.
- `payout` is **permissionless trigger, fixed recipient**. Credit from SETTLED state can be paid to winner only. Refund claimant always `msg.sender` if depositor and CANCELED, exactly once.
- Confirm state read after tx before UI final badges. Contract event receipt is proof of on-chain activity; it does not prove off-chain fair gameplay.
- `cancelRoom` operator call is permitted on unresolved room even FUNDED; record reason. Permissionless expiry is recovery if operator disappears. Role powers described in security document.

## Server security / backend
- Wallet signature challenge to prove ownership: nonce + domain + wallet + chainId + expiry, single use, domain separated (SIWE/EIP-4361 where feasible). Store nonces in process RAM, rotate session tokens, HTTPS only. This is a demo auth, not production-grade persistent auth.
- Rate-limit room code lookups and tx confirmation calls; never honor client reported payer or wallet just from request body; bind to session.
- Watch events via polling with cursor/caught-up flag or websocket, verify receipts, dedupe logs by `(txHash, logIndex)` and reconcile state on startup.
- Use `simulateContract` before writes where possible; handle wallet rejected tx, gas estimation failure, replaced tx, RPC lag, and chain reorg/reconciliation.

## Unit/integration test plan
- Gameplay: GS-01..GS-12 plus 3/4 real users on device matrix.
- Contract: full threat matrix `ESCROW_SECURITY.md`, local EVM tests plus canary on Monad Testnet.
- Backend: unknown/foreign txHash rejected; address spoof rejected; expired room; duplicate logs; crash after deposits; canceled on chain while countdown; settle failed; wallet returns from mobile deep link.
- Performance: record local client click→receipt and contract event times, do not claim protocol TPS as measured throughput.

## Release commands (examples, versions must be pinned by dev)
```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
forge test -vvv
# testnet deployment after passing tests and confirming chainId=10143
# record the actual contract address, abi checksum and tx in deployment notes
```
Only run/deploy once external environment, wallet, key and contract code actually exist. The docs contain no deployable contract.

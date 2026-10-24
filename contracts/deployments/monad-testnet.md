# Escrow deployment — Monad Testnet

**Deployed:** 2026-10-24
**Chain:** Monad Testnet (10143)
**Contract:** `TestnetPoolEscrow`

## Address

```
ESCROW_ADDRESS=0x8c839fab937a08177c2779eef36c15d8999be8fe
```

Verified on chain: code present (15530 hex chars), `entryBounds()` = 1e15..1e16 wei,
admin holds `DEFAULT_ADMIN_ROLE`, settler holds `SETTLER_ROLE`.

## Roles

| Role | Address | Key location |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | `0xAf836EfF9F9bC39E00576ec4af36053dfeF6ABf2` | `D:\LOMBA ABYAN\Monad\wallets.local.txt` |
| `SETTLER_ROLE` | `0x3419163ffE7D12Dc3b08187B3fBC2E622e1D29aD` | same file, server env |

Admin and settler are different keys, as required. `verify-deploy.sh` confirms it.

## Apply to the repo

```bash
ESCROW_ADDRESS=0x8c839fab937a08177c2779eef36c15d8999be8fe
ESCROW_DEPLOYMENT_BLOCK=73756739
SERVER_SETTLER_PRIVATE_KEY=<SETTLER_KEY from wallets.local.txt>
VITE_ESCROW_ADDRESS=0x8c839fab937a08177c2779eef36c15d8999be8fe
```

`ESCROW_DEPLOYMENT_BLOCK` was found by binary-searching `cast code` per block:
block 73756738 returns `0x`, block 73756739 returns bytecode. The Monad testnet RPC
caps `eth_getLogs` at a 100-block range, so a scan from genesis is impossible — the
backend must start at this block and paginate in chunks of ≤100.

## Warning about the broadcast files

`contracts/broadcast/Deploy.s.sol/10143/` contains SEVEN runs mixed together:
the local anvil harness uses chainId 10143 too, so its deployments share the
same directory as the testnet ones. `run-latest.json` currently points at an
**anvil** address (`0xc5273a...`) that does not exist on testnet.

Do not read the address from `run-latest.json`. The address above was verified by
`cast code` against `https://testnet-rpc.monad.xyz`, which is the only check that
matters.

## Still missing

**Source verification** on the explorers (`POST https://agents.devnads.com/v1/verify`).
Until that runs, the explorer shows bytecode only.

Everything else on this page is verified against the chain.

## Not yet done

- Source verification (see above).
- No `createRoom` has been issued. The contract holds zero funds.
- No settlement or payout has been executed on testnet.

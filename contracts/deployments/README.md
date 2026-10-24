# Deployed addresses

One file per network. Committed, because the frontend and server both need the
address and a chain record is unattributable without it.

| Network | chainId | Address | Notes |
|---|---|---|---|
| Monad Testnet | 10143 | _not deployed yet_ | Deploy with `forge script script/Deploy.s.sol:Deploy` |

## Record after deploying

```ini
# deployments/monad-testnet.env
ESCROW_ADDRESS=0x...
ESCROW_DEPLOYMENT_BLOCK=0
SETTLER_ADDRESS=0x...
ADMIN_ADDRESS=0x...
DEPLOY_TX_HASH=0x...
DEPLOYED_AT=YYYY-MM-DD
```

Three fields are load-bearing beyond the address:

- **`ESCROW_DEPLOYMENT_BLOCK`** — the backend bounds its `eth_getLogs` scan with this
  (`TRD.md:33`, `SYS.md:44`). Without it, recovery after a restart either scans from
  genesis or silently misses deposits. The deploy script prints it.
- **`SETTLER_ADDRESS`** — must equal the server's `SERVER_SETTLER_PRIVATE_KEY`
  address, or `settle` reverts and the winner screen shows `FAILED`. Correct
  behaviour, wasted demo.
- **`ADMIN_ADDRESS`** — must *differ* from the settler. Same key means a leaked
  server key can grant roles and cancel funded rooms
  (`ESCROW_SECURITY.md:8`, `DECISIONS.md:36`).

Verify after deploying:

```bash
cast call $ESCROW_ADDRESS "hasRole(bytes32,address)(bool)" \
  $(cast keccak "SETTLER_ROLE") $SETTLER_ADDRESS --rpc-url https://testnet-rpc.monad.xyz
cast call $ESCROW_ADDRESS "entryBounds()(uint256,uint256)" \
  --rpc-url https://testnet-rpc.monad.xyz
```

Then read back the enforced bounds and confirm they match `packages/shared`. The
backend must not hardcode a range that diverged from the deployed contract.

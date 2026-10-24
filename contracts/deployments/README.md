# Deployed addresses

One file per network. Committed, because the frontend and server both need the
address and a chain record is unattributable without it.

| Network | chainId | Address | Notes |
|---|---|---|---|
| Monad Testnet | 10143 | _not deployed yet_ | Deploy with `forge script script/Deploy.s.sol:Deploy` |

## Record after deploying

```ini
# deployments/monad-testnet.env
MATCH_REGISTRY_ADDRESS=0x...
DEPLOY_TX_HASH=0x...
OWNER=0x...
DEPLOYED_AT=YYYY-MM-DD
```

Then confirm the owner matches the server's `SERVER_SIGNER_PRIVATE_KEY` address.
A mismatch means the server cannot call `recordMatch` and the winner screen will
show `FAILED` — correct behaviour, but a wasted demo.

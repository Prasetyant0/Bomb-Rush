# contracts — Smart Contracts

Solidity smart contracts and their tests for recording match results on **Monad Testnet** (chainId 10143). Scope: a minimal match-registry that stores confirmed match outcomes (match id, winner, result hash). No value pooling, no mainnet deployment.

Owned by the Solidity/Monad integration developer.

## Layout

| Path | Purpose |
|---|---|
| `src/MatchRegistry.sol` | The only contract. `onlyOwner` record of finished matches. |
| `test/MatchRegistry.t.sol` | 9 tests: the four TRD smoke cases plus guest win, read-back, and hash parity. |
| `script/Deploy.s.sol` | Chain-gated deploy script (refuses anything but 10143). |

## Commands

```bash
cd contracts

# One-time: forge-std is gitignored, reinstall it after cloning.
forge install foundry-rs/forge-std --no-git

forge build
forge test -vv

# Deploy — the signer becomes the owner and must match the server's
# SERVER_SIGNER_PRIVATE_KEY.
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$MONAD_RPC_URL" --broadcast
```

## What the contract is and is not

It records `matchId`, `winner`, `guestHash`, `resultHash`, `recordedAt` and emits
`MatchRecorded`. It does **not** decide the winner, hold value, accept deposits,
or pay out. The game server is the authority; the chain is the audit trail.

- **Auth:** `onlyOwner`. No ECDSA signature argument, no nonce — a signature
  scheme is a feature, not a six-hour shortcut (`docs/spec/TRD.md` §6).
- **Guest wins** store `winner = address(0)` with a non-zero `guestHash`. The
  server guarantees the two are never both zero and never both non-zero; the
  contract cannot check that, because it never sees the participant list.
- **Duplicates revert.** The server treats `AlreadyRecorded` as "already
  recorded" and fetches the existing record rather than retrying.
- **`resultHash` is computed off-chain**, exactly as `docs/spec/API_CONTRACT.md`
  §2 specifies (ABI-encoded, sorted ids, `uint256` credits). `matchId` arrives
  already converted to `bytes32` via `keccak256(toHex(offChainMatchId))`.

`test_ResultHashMatchesCanonicalEncoding` pins the encoding with a value computed
independently by `cast abi-encode`. If either side of the boundary changes its
encoding, that test fails before a mismatch can reach a deployed contract.

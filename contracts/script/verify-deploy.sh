#!/usr/bin/env bash
# Post-deploy verification for TestnetPoolEscrow on Monad Testnet (10143).
#
# Run this BEFORE the demo, not after. It asserts the four facts that decide
# whether the funded flow can work at all:
#
#   1. there is code at the address, on the right chain
#   2. DEFAULT_ADMIN_ROLE and SETTLER_ROLE went to the addresses you think
#   3. admin != settler, so a leaked server key cannot cancel rooms
#   4. the contract's entry bounds match what packages/shared expects
#
# Usage:
#   ./script/verify-deploy.sh <escrow-address> <admin-address> <settler-address>
#
# Requires: cast (foundry). No private key needed — everything here is a read.

set -euo pipefail

RPC="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
EXPECTED_CHAIN=10143
ESCROW="${1:-}"
ADMIN="${2:-}"
SETTLER="${3:-}"

fail() { printf '  FAIL  %s\n' "$1" >&2; exit 1; }
pass() { printf '  ok    %s\n' "$1"; }

[ -n "$ESCROW" ] && [ -n "$ADMIN" ] && [ -n "$SETTLER" ] || {
  echo "usage: $0 <escrow-address> <admin-address> <settler-address>" >&2
  exit 2
}

command -v cast >/dev/null || fail "cast not found; install foundry"

echo "Verifying $ESCROW on Monad Testnet"
echo

# --- 1. chain ---------------------------------------------------------------
CHAIN=$(cast chain-id --rpc-url "$RPC")
[ "$CHAIN" = "$EXPECTED_CHAIN" ] || fail "RPC is chain $CHAIN, expected $EXPECTED_CHAIN"
pass "RPC chain id is $CHAIN"

CODE=$(cast code "$ESCROW" --rpc-url "$RPC")
[ "$CODE" != "0x" ] || fail "no code at $ESCROW on chain $CHAIN"
pass "code deployed (${#CODE} hex chars)"

# --- 2. roles ---------------------------------------------------------------
SETTLER_ROLE=$(cast keccak "SETTLER_ROLE")
DEFAULT_ADMIN_ROLE="0x$(printf '0%.0s' {1..64})"

has_admin=$(cast call "$ESCROW" "hasRole(bytes32,address)(bool)" \
  "$DEFAULT_ADMIN_ROLE" "$ADMIN" --rpc-url "$RPC")
[ "$has_admin" = "true" ] || fail "admin $ADMIN does NOT hold DEFAULT_ADMIN_ROLE"
pass "admin holds DEFAULT_ADMIN_ROLE"

has_settler=$(cast call "$ESCROW" "hasRole(bytes32,address)(bool)" \
  "$SETTLER_ROLE" "$SETTLER" --rpc-url "$RPC")
[ "$has_settler" = "true" ] || fail "settler $SETTLER does NOT hold SETTLER_ROLE"
pass "server signer holds SETTLER_ROLE"

# The settler must NOT also be admin: otherwise a leaked hot key can grant roles
# and cancel funded rooms (ESCROW_SECURITY §"Key handling").
settler_is_admin=$(cast call "$ESCROW" "hasRole(bytes32,address)(bool)" \
  "$DEFAULT_ADMIN_ROLE" "$SETTLER" --rpc-url "$RPC")
[ "$settler_is_admin" = "false" ] || fail "settler also holds DEFAULT_ADMIN_ROLE — keys are not separated"
pass "admin and settler are separate keys"

# --- 3. entry bounds --------------------------------------------------------
BOUNDS=$(cast call "$ESCROW" "entryBounds()(uint256,uint256)" --rpc-url "$RPC")
MIN_WEI=$(echo "$BOUNDS" | sed -n '1p' | awk '{print $1}')
MAX_WEI=$(echo "$BOUNDS" | sed -n '2p' | awk '{print $1}')
[ -n "$MIN_WEI" ] && [ -n "$MAX_WEI" ] || fail "entryBounds() returned nothing"
pass "entry bounds: $MIN_WEI .. $MAX_WEI wei"

# Read the shared package's expectation if it exists. The backend must use the
# on-chain value, but a mismatch here means someone will hardcode the wrong one.
SHARED="$(dirname "$0")/../../packages/shared/src/index.ts"
if [ -f "$SHARED" ] && grep -q "ENTRY_MIN_WEI" "$SHARED"; then
  SHARED_MIN=$(grep -oE "ENTRY_MIN_WEI[^0-9]*([0-9_]+)" "$SHARED" | grep -oE "[0-9_]+" | tail -1 | tr -d '_')
  if [ -n "$SHARED_MIN" ] && [ "$SHARED_MIN" != "$MIN_WEI" ]; then
    fail "packages/shared ENTRY_MIN_WEI=$SHARED_MIN but contract says $MIN_WEI"
  fi
  pass "entry bounds agree with packages/shared"
else
  echo "  skip  packages/shared has no ENTRY_MIN_WEI yet (v0.5 fields not merged)"
fi

# --- 4. windows -------------------------------------------------------------
RES=$(cast call "$ESCROW" "maxResolutionWindowSec()(uint64)" --rpc-url "$RPC")
FUND=$(cast call "$ESCROW" "maxFundingWindowSec()(uint64)" --rpc-url "$RPC")
pass "windows: funding<=${FUND}s, resolution<=${RES}s"

echo
echo "All checks passed. Record this address and block in contracts/deployments/monad-testnet.env:"
echo "  ESCROW_ADDRESS=$ESCROW"
echo "  ESCROW_DEPLOYMENT_BLOCK=<block the tx landed in, not the current block>"
echo "  SETTLER_ADDRESS=$SETTLER"
echo "  ADMIN_ADDRESS=$ADMIN"

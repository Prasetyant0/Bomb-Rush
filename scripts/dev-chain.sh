#!/usr/bin/env bash
# dev-chain.sh — local chainId-10143 chain for the escrow E2E proof.
#
# 1. starts anvil (deterministic dev mnemonic) in the background and waits for RPC
# 2. deploys TestnetPoolEscrow with `forge script script/Deploy.s.sol:Deploy`
#      admin   = anvil key 0 (DEFAULT_ADMIN_ROLE, cold)
#      settler = anvil key 1 (SETTLER_ROLE, hot)  -- deliberately a different key
# 3. funds 3 player wallets (+ a third-party payout caller)
# 4. writes scripts/.local-chain.env with ESCROW_ADDRESS, ESCROW_DEPLOYMENT_BLOCK,
#    ADMIN_KEY, SETTLER_KEY, P1_KEY, P2_KEY, P3_KEY, RPC_URL, ...
#
# Idempotent: if the recorded chain is still live and the escrow still answers
# with the expected roles, it reuses it and prints the summary.
#
# Usage:
#   scripts/dev-chain.sh            # start (or reuse)
#   scripts/dev-chain.sh --status   # print summary, change nothing
#   scripts/dev-chain.sh --stop     # stop a chain started by this script
#   scripts/dev-chain.sh --restart  # stop, then start a clean chain
#
# Env overrides: MONAD_LOCAL_PORT (8545), MONAD_LOCAL_HOST (127.0.0.1),
#                ENTRY_MIN_WEI, ENTRY_MAX_WEI, FUNDING_WINDOW_SEC, RESOLUTION_WINDOW_SEC

set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

HOST="${MONAD_LOCAL_HOST:-127.0.0.1}"
PORT="${MONAD_LOCAL_PORT:-8545}"
STATE_DIR="$SCRIPTS_DIR/.local-chain"
ANVIL_LOG="$STATE_DIR/anvil.log"
PID_FILE="$STATE_DIR/anvil.pid"
HARNESS_ID="escrow-e2e-v1"

MODE="start"
case "${1:-}" in
  --restart) MODE="restart" ;;
  --status)  MODE="status" ;;
  --stop)    MODE="stop" ;;
  "")        ;;
  -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)         die "unknown argument '$1' (try --help)" ;;
esac

need_cmd anvil cast forge jq node timeout
mkdir -p "$STATE_DIR"

# Blank a state file rather than unlinking it: a missing file and an empty file
# are both "no recorded chain" to every reader below.
blank_file() { if [ -f "$1" ]; then : >"$1"; fi; }

anvil_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && printf '%s' "$pid"
}

stop_chain() {
  local pid
  if pid="$(anvil_pid)"; then
    info "stopping anvil pid $pid"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  blank_file "$PID_FILE"
  blank_file "$CHAIN_ENV"
}

wait_for_rpc() {
  local i
  for i in $(seq 1 100); do
    rpc_ready && return 0
    sleep 0.1
  done
  bad "anvil did not answer on $RPC_URL within 10s"
  if [ -f "$ANVIL_LOG" ]; then tail -20 "$ANVIL_LOG" >&2 || true; fi
  return 1
}

# Is the recorded env file describing a live chain we can still use?
chain_is_live_and_matching() {
  [ -f "$CHAIN_ENV" ] || return 1
  # Require OUR schema. A file written by another tool (or an older harness with
  # different variable names) is not something this harness can drive.
  grep -q "^HARNESS=$HARNESS_ID\$" "$CHAIN_ENV" 2>/dev/null || return 1

  # shellcheck disable=SC1090
  ( set -a; . "$CHAIN_ENV"
    for v in ESCROW_ADDRESS ADMIN_ADDRESS SETTLER_ADDRESS ADMIN_KEY SETTLER_KEY \
             P1_ADDRESS P1_KEY P2_ADDRESS P2_KEY P3_ADDRESS P3_KEY; do
      [ -n "${!v:-}" ] || exit 1
    done
    [ "$ADMIN_ADDRESS" != "$SETTLER_ADDRESS" ] || exit 1
  ) || return 1

  rpc_ready || return 1
  [ "$(c chain-id --rpc-url "$RPC_URL")" = "$CHAIN_ID" ] || return 1

  # The env's RPC must be the RPC we were told to use, not a stale port.
  # shellcheck disable=SC1090
  ( set -a; . "$CHAIN_ENV"; [ "${RPC_URL:-}" = "$RPC_URL" ] ) || return 1

  # shellcheck disable=SC1090
  set -a; . "$CHAIN_ENV"; set +a
  [ "$(c code "$ESCROW_ADDRESS" --rpc-url "$RPC_URL")" != "0x" ] || return 1

  [ "$(has_role DEFAULT_ADMIN_ROLE "$ADMIN_ADDRESS")" = "true" ] || return 1
  [ "$(has_role SETTLER_ROLE "$SETTLER_ADDRESS")" = "true" ] || return 1
  [ "$(has_role DEFAULT_ADMIN_ROLE "$SETTLER_ADDRESS")" = "false" ] || return 1
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print_summary() {
  hr
  hdr "LOCAL ESCROW CHAIN"
  hr
  printf 'RPC              %s\n' "$RPC_URL"
  printf 'chainId          %s\n' "$CHAIN_ID"
  printf 'anvil pid        %s\n' "$(anvil_pid || echo '(external / not recorded)')"
  printf 'escrow           %s\n' "$ESCROW_ADDRESS"
  printf 'deploy block     %s\n' "$ESCROW_DEPLOYMENT_BLOCK"
  printf 'admin            %s  (DEFAULT_ADMIN_ROLE, key 0)\n' "$ADMIN_ADDRESS"
  printf 'settler          %s  (SETTLER_ROLE, key 1)\n' "$SETTLER_ADDRESS"
  printf 'players          %s\n' "$P1_ADDRESS"
  printf '                 %s\n' "$P2_ADDRESS"
  printf '                 %s\n' "$P3_ADDRESS"
  printf 'entry bounds     %s .. %s wei\n' "$ENTRY_MIN_WEI" "$ENTRY_MAX_WEI"
  printf 'contract balance %s wei\n' "$(balance_of "$ESCROW_ADDRESS")"
  printf 'block height     %s\n' "$(c block-number --rpc-url "$RPC_URL")"
  printf 'env file         %s\n' "$CHAIN_ENV"
  hr
}

# ---------------------------------------------------------------- status/stop

if [ "$MODE" = "status" ]; then
  if chain_is_live_and_matching; then print_summary; exit 0; fi
  echo "No live dev chain recorded for $RPC_URL."
  exit 1
fi

if [ "$MODE" = "stop" ]; then
  stop_chain
  ok "dev chain stopped; $CHAIN_ENV invalidated"
  exit 0
fi

if [ "$MODE" = "restart" ]; then
  stop_chain
elif chain_is_live_and_matching; then
  ok "reusing live dev chain at $RPC_URL (escrow $ESCROW_ADDRESS)"
  print_summary
  exit 0
fi

# A foreign chain on the port is not ours to kill.
if rpc_ready; then
  other="$(c chain-id --rpc-url "$RPC_URL" || echo "?")"
  [ "$other" = "$CHAIN_ID" ] \
    || die "a different chain (id $other) is listening on $RPC_URL; stop it or set MONAD_LOCAL_PORT"
  info "chain $CHAIN_ID already up but not recorded here; deploying onto it"
fi

blank_file "$CHAIN_ENV"; blank_file "$PID_FILE"

# ------------------------------------------------------------------ start node

info "starting anvil on $RPC_URL (chainId $CHAIN_ID)"
: >"$ANVIL_LOG"
nohup anvil \
  --chain-id "$CHAIN_ID" \
  --host "$HOST" \
  --port "$PORT" \
  --mnemonic "$DEV_MNEMONIC" \
  --accounts 10 \
  --balance 1000 \
  --silent \
  >>"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
disown "$ANVIL_PID" 2>/dev/null || true
printf '%s' "$ANVIL_PID" >"$PID_FILE"

cleanup_on_error() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    bad "dev-chain.sh failed (exit $rc); stopping the anvil it started"
    kill "$ANVIL_PID" 2>/dev/null || true
    blank_file "$PID_FILE"; blank_file "$CHAIN_ENV"
  fi
}
trap cleanup_on_error EXIT

wait_for_rpc || exit 1
CHAIN_NOW="$(c chain-id --rpc-url "$RPC_URL")"
[ "$CHAIN_NOW" = "$CHAIN_ID" ] || die "anvil reported chainId $CHAIN_NOW, expected $CHAIN_ID"
ok "anvil up (pid $ANVIL_PID, chainId $CHAIN_NOW)"

# ---------------------------------------------------------------- deterministic keys

key_at() { c wallet private-key --mnemonic "$DEV_MNEMONIC" --mnemonic-index "$1"; }

ADMIN_KEY="$(key_at 0)";       ADMIN_ADDRESS="$(addr_of_pk "$ADMIN_KEY")"
SETTLER_KEY="$(key_at 1)";     SETTLER_ADDRESS="$(addr_of_pk "$SETTLER_KEY")"
P1_KEY="$(key_at 2)";          P1_ADDRESS="$(addr_of_pk "$P1_KEY")"
P2_KEY="$(key_at 3)";          P2_ADDRESS="$(addr_of_pk "$P2_KEY")"
P3_KEY="$(key_at 4)";          P3_ADDRESS="$(addr_of_pk "$P3_KEY")"
THIRD_PARTY_KEY="$(key_at 5)"; THIRD_PARTY_ADDRESS="$(addr_of_pk "$THIRD_PARTY_KEY")"

[ "$ADMIN_ADDRESS" != "$SETTLER_ADDRESS" ] || die "admin == settler; key separation broken"

# 3 player wallets + an unrelated payout caller, each funded explicitly.
PLAYER_FUND_WEI=100000000000000000000   # 100 MON
for pair in "P1:$P1_ADDRESS" "P2:$P2_ADDRESS" "P3:$P3_ADDRESS" \
            "THIRD_PARTY:$THIRD_PARTY_ADDRESS"; do
  n="${pair%%:*}"; a="${pair#*:}"
  fund_addr "$a" "$PLAYER_FUND_WEI"
  got="$(balance_of "$a")"
  [ "$got" = "$PLAYER_FUND_WEI" ] || die "$n funding failed: got $got wei"
done
ok "3 player wallets (+ payout caller) funded at $PLAYER_FUND_WEI wei each"

# ------------------------------------------------------------------- deploy

[ -d "$CONTRACTS_DIR/lib/forge-std" ] \
  || die "contracts/lib/forge-std missing (run: cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git)"

info "building contracts"
( cd "$CONTRACTS_DIR" && forge build --quiet ) || die "forge build failed"

info "deploying via forge script (admin=$ADMIN_ADDRESS settler=$SETTLER_ADDRESS)"
( cd "$CONTRACTS_DIR" && \
  PRIVATE_KEY="$ADMIN_KEY" \
  ADMIN_ADDRESS="$ADMIN_ADDRESS" \
  SETTLER_ADDRESS="$SETTLER_ADDRESS" \
  ENTRY_MIN_WEI="$ENTRY_MIN_WEI" \
  ENTRY_MAX_WEI="$ENTRY_MAX_WEI" \
  FUNDING_WINDOW_SEC="$FUNDING_WINDOW_SEC" \
  RESOLUTION_WINDOW_SEC="$RESOLUTION_WINDOW_SEC" \
  forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast \
) || die "forge script deploy failed"

BROADCAST_JSON="$CONTRACTS_DIR/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
[ -f "$BROADCAST_JSON" ] || die "broadcast file missing: $BROADCAST_JSON"

ESCROW_ADDRESS="$(jq -r '[.transactions[] | select(.transactionType=="CREATE")][-1].contractAddress' "$BROADCAST_JSON")"
DEPLOY_TX_HASH="$(jq -r '[.transactions[] | select(.transactionType=="CREATE")][-1].hash' "$BROADCAST_JSON")"
[ -n "$ESCROW_ADDRESS" ] && [ "$ESCROW_ADDRESS" != "null" ] || die "no CREATE transaction in $BROADCAST_JSON"

ESCROW_DEPLOYMENT_BLOCK="$(c receipt "$DEPLOY_TX_HASH" blockNumber --rpc-url "$RPC_URL")"
[ "$(c code "$ESCROW_ADDRESS" --rpc-url "$RPC_URL")" != "0x" ] || die "no code at $ESCROW_ADDRESS after deploy"

# Verify the deployment from chain state, not from intent.
[ "$(has_role DEFAULT_ADMIN_ROLE "$ADMIN_ADDRESS")" = "true" ] || die "admin lacks DEFAULT_ADMIN_ROLE"
[ "$(has_role SETTLER_ROLE "$SETTLER_ADDRESS")" = "true" ] || die "settler lacks SETTLER_ROLE"
[ "$(has_role DEFAULT_ADMIN_ROLE "$SETTLER_ADDRESS")" = "false" ] || die "settler holds DEFAULT_ADMIN_ROLE"
[ "$(read_uint 'entryMinWei()(uint256)')" = "$ENTRY_MIN_WEI" ] || die "entryMinWei on chain != $ENTRY_MIN_WEI"
[ "$(read_uint 'entryMaxWei()(uint256)')" = "$ENTRY_MAX_WEI" ] || die "entryMaxWei on chain != $ENTRY_MAX_WEI"
ok "deployed at $ESCROW_ADDRESS (block $ESCROW_DEPLOYMENT_BLOCK); roles and bounds verified on chain"

# QA_CROSSPLAY ST08 needs a depositor that rejects native transfers. It is a test
# helper from contracts/test/e2e/, not part of the shipped contract.
info "deploying RejectingDepositor helper (ST08)"
HELPER_JSON="$( cd "$CONTRACTS_DIR" && forge create "$SETTLEMENT_HELPER" \
  --rpc-url "$RPC_URL" --private-key "$ADMIN_KEY" --broadcast --json \
  --constructor-args "$ESCROW_ADDRESS" )" || die "helper deploy failed"
REJECTING_HELPER_ADDRESS="$(printf '%s' "$HELPER_JSON" | jq -r '.deployedTo')"
[ -n "$REJECTING_HELPER_ADDRESS" ] && [ "$REJECTING_HELPER_ADDRESS" != "null" ] \
  || die "helper deploy produced no address"
[ "$(c code "$REJECTING_HELPER_ADDRESS" --rpc-url "$RPC_URL")" != "0x" ] \
  || die "no code at $REJECTING_HELPER_ADDRESS after helper deploy"
ok "helper at $REJECTING_HELPER_ADDRESS"

# ---------------------------------------------------------------- write env

umask 077
cat >"$CHAIN_ENV" <<EOF
# Generated by scripts/dev-chain.sh — LOCAL ANVIL ONLY, never commit.
# Public anvil dev mnemonic (indices 0..5). Worthless test keys.
HARNESS=$HARNESS_ID
LOCAL_CHAIN=1
CHAIN_ID=$CHAIN_ID
RPC_URL=$RPC_URL

ESCROW_ADDRESS=$ESCROW_ADDRESS
ESCROW_DEPLOYMENT_BLOCK=$ESCROW_DEPLOYMENT_BLOCK
DEPLOY_TX_HASH=$DEPLOY_TX_HASH
REJECTING_HELPER_ADDRESS=$REJECTING_HELPER_ADDRESS

ENTRY_MIN_WEI=$ENTRY_MIN_WEI
ENTRY_MAX_WEI=$ENTRY_MAX_WEI
FUNDING_WINDOW_SEC=$FUNDING_WINDOW_SEC
RESOLUTION_WINDOW_SEC=$RESOLUTION_WINDOW_SEC

ADMIN_ADDRESS=$ADMIN_ADDRESS
ADMIN_KEY=$ADMIN_KEY
SETTLER_ADDRESS=$SETTLER_ADDRESS
SETTLER_KEY=$SETTLER_KEY
P1_ADDRESS=$P1_ADDRESS
P1_KEY=$P1_KEY
P2_ADDRESS=$P2_ADDRESS
P2_KEY=$P2_KEY
P3_ADDRESS=$P3_ADDRESS
P3_KEY=$P3_KEY
THIRD_PARTY_ADDRESS=$THIRD_PARTY_ADDRESS
THIRD_PARTY_KEY=$THIRD_PARTY_KEY
EOF
trap - EXIT

print_summary
cat <<EOF

Next: scripts/e2e-escrow.sh
EOF

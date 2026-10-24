#!/usr/bin/env bash
# Shared helpers for the local escrow E2E harness. Sourced, never executed.
#
# Everything here drives a real anvil node through real `cast` calls. There are
# no mocks in this harness.
#
# Requires: bash 4+, cast, anvil, forge, jq, node.

# Bump when the env schema changes; dev-chain.sh refuses to reuse older files.
# shellcheck disable=SC2034
HARNESS_SCHEMA="escrow-e2e-v1"

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

# shellcheck disable=SC2034
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034
SCRIPTS_DIR="$(cd "$LIB_DIR/.." && pwd)"
# shellcheck disable=SC2034
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
# shellcheck disable=SC2034
CONTRACTS_DIR="$REPO_ROOT/contracts"

# shellcheck disable=SC2034
CHAIN_ID=10143
# shellcheck disable=SC2034
RPC_URL="${MONAD_LOCAL_RPC:-http://127.0.0.1:${MONAD_LOCAL_PORT:-8545}}"

# Filesystem-safe tag for this chain, so per-run artifacts never collide.
# shellcheck disable=SC2034
PORT_TAG="chain-$(printf '%s' "$RPC_URL" | sed 's|^https\?://||; s|[^A-Za-z0-9]|_|g')"

# The default chain (port 8545) records to scripts/.local-chain.env, the path the
# README and the task refer to. A non-default port gets its own file so two
# harnesses can run side by side without clobbering each other.
if [ "${MONAD_LOCAL_PORT:-8545}" = "8545" ] && [ -z "${MONAD_LOCAL_RPC:-}" ]; then
  # shellcheck disable=SC2034
  CHAIN_ENV="${MONAD_LOCAL_ENV:-$SCRIPTS_DIR/.local-chain.env}"
else
  # shellcheck disable=SC2034
  CHAIN_ENV="${MONAD_LOCAL_ENV:-$SCRIPTS_DIR/.local-chain/$PORT_TAG.env}"
fi

# Relative to $CONTRACTS_DIR: forge mangles absolute Windows paths.
# shellcheck disable=SC2034
SETTLEMENT_HELPER="test/e2e/LocalE2E.s.sol:RejectingDepositor"

# Product defaults, identical to contracts/script/Deploy.s.sol.
# shellcheck disable=SC2034
ENTRY_MIN_WEI="${ENTRY_MIN_WEI:-1000000000000000}"      # 0.001 MON
# shellcheck disable=SC2034
ENTRY_MAX_WEI="${ENTRY_MAX_WEI:-10000000000000000}"     # 0.01 MON
# shellcheck disable=SC2034
FUNDING_WINDOW_SEC="${FUNDING_WINDOW_SEC:-600}"
# shellcheck disable=SC2034
RESOLUTION_WINDOW_SEC="${RESOLUTION_WINDOW_SEC:-1200}"
# shellcheck disable=SC2034
ENTRY_WEI="${ENTRY_WEI:-1000000000000000}"              # stake used by the E2E

# The standard anvil dev mnemonic. Publicly known, worthless, test-only.
# shellcheck disable=SC2034
DEV_MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

# getRoom returns the 12-field Room struct as a single tuple.
# shellcheck disable=SC2034
GET_ROOM_SIG='getRoom(bytes32)((address,uint8,uint8,uint256,uint256,uint64,uint64,uint8,address,bytes32,bytes32,bool))'

# Room field indices, per contracts/ABI_HANDOFF.md §2.
# shellcheck disable=SC2034
R_HOST=0; R_MAX_SEATS=1; R_DEPOSIT_COUNT=2; R_ENTRY=3; R_POT=4
# shellcheck disable=SC2034
R_FUNDING_DEADLINE=5; R_RESOLUTION_DEADLINE=6; R_STATUS=7
# shellcheck disable=SC2034
R_WINNER=8; R_RESULT_HASH=9; R_CANCEL_REASON=10; R_PRIZE_PAID=11

# EscrowStatus ordinals, pinned in ABI_HANDOFF.md §2.
# shellcheck disable=SC2034
ST_NONE=0; ST_FUNDING=1; ST_FUNDED=2; ST_SETTLED=3; ST_CANCELED=4

FOUNDRY_DISABLE_NIGHTLY_WARNING="${FOUNDRY_DISABLE_NIGHTLY_WARNING:-1}"
export FOUNDRY_DISABLE_NIGHTLY_WARNING

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_HDR=$'\033[1;36m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_BAD=''; C_DIM=''; C_HDR=''; C_OFF=''
fi

hr()   { printf '%s\n' "------------------------------------------------------------"; }
# shellcheck disable=SC2059
hdr()  { printf '\n%s%s%s\n' "$C_HDR" "$1" "$C_OFF"; }
# shellcheck disable=SC2059
step() { printf '\n%s[%s]%s %s\n' "$C_HDR" "$1" "$C_OFF" "$2"; }
# shellcheck disable=SC2059
ok()   { printf '  %sPASS%s  %s\n' "$C_OK" "$C_OFF" "$1"; }
# shellcheck disable=SC2059
bad()  { printf '  %sFAIL%s  %s\n' "$C_BAD" "$C_OFF" "$1" >&2; }
# shellcheck disable=SC2059
info() { printf '  %s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }
skip() { printf '  SKIP  %s\n' "$1"; }

die() { bad "$1"; exit 1; }

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

need_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 \
      || die "required command '$c' not found on PATH. Install foundry (cast/anvil/forge) and jq."
  done
}

# 256-bit arithmetic. Bash integers are 64-bit and wei balances are 256-bit.
#   bn <op> <a> [b]     ops: add sub mul hex print, or eq/gt/lt (exit 0 = true)
bn() {
  node -e '
const [op, a, b] = process.argv.slice(1);
const A = BigInt(a);
const B = (b === undefined || b === "") ? 0n : BigInt(b);
switch (op) {
  case "add": console.log((A + B).toString()); break;
  case "sub": console.log((A - B).toString()); break;
  case "mul": console.log((A * B).toString()); break;
  case "hex": console.log("0x" + A.toString(16)); break;
  // Decimal or 0x-hex input; output is always decimal.
  case "print": console.log(A.toString()); break;
  case "eq": process.exit(A === B ? 0 : 1);
  case "gt": process.exit(A > B ? 0 : 1);
  case "lt": process.exit(A < B ? 0 : 1);
  default: console.error("bn: unknown op " + op); process.exit(2);
}' -- "$@"
}

# ---------------------------------------------------------------------------
# Chain helpers
# ---------------------------------------------------------------------------

# `cast` with a hard timeout so a dead node fails fast instead of hanging.
# Output is stripped of \r: on Windows, cast/jq emit CRLF, and a stray \r silently
# breaks every string comparison in this harness. The PIPESTATUS dance keeps
# cast's real exit code, which the negative checks rely on.
c() {
  local out rc
  out="$(timeout 25 cast "$@" | tr -d '\r')"
  rc=${PIPESTATUS[0]}
  printf '%s' "$out"
  return "$rc"
}

rpc_ready() { c chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; }

require_chain() {
  rpc_ready || die "no RPC at $RPC_URL. Start it with scripts/dev-chain.sh."
  local got; got="$(c chain-id --rpc-url "$RPC_URL")"
  [ "$got" = "$CHAIN_ID" ] || die "RPC at $RPC_URL is chain $got, expected $CHAIN_ID"
}

require_chain_env() {
  [ -f "$CHAIN_ENV" ] || die "$CHAIN_ENV missing. Run scripts/dev-chain.sh first."
  # Compare the value only: the file's last line may lack a trailing newline.
  awk -F= '$1 == "HARNESS" { print $2 }' "$CHAIN_ENV" | grep -qx "$HARNESS_SCHEMA" \
    || die "$CHAIN_ENV was not written by this harness's dev-chain.sh. Re-run scripts/dev-chain.sh."
  # shellcheck disable=SC1090
  . "$CHAIN_ENV"
  local v
  for v in ESCROW_ADDRESS ESCROW_DEPLOYMENT_BLOCK ADMIN_ADDRESS SETTLER_ADDRESS \
           ADMIN_KEY SETTLER_KEY P1_ADDRESS P1_KEY P2_ADDRESS P2_KEY P3_ADDRESS P3_KEY \
           THIRD_PARTY_ADDRESS THIRD_PARTY_KEY RPC_URL; do
    [ -n "${!v:-}" ] || die "$CHAIN_ENV has no $v. Re-run scripts/dev-chain.sh."
  done
  # The env must describe the chain we were told to talk to, not another port.
  [ "$RPC_URL" = "${MONAD_LOCAL_RPC:-http://127.0.0.1:${MONAD_LOCAL_PORT:-8545}}" ] \
    || die "$CHAIN_ENV points at $RPC_URL but MONAD_LOCAL_PORT/MONAD_LOCAL_RPC says otherwise. Re-run scripts/dev-chain.sh."
}

addr_of_pk() { c wallet address --private-key "$1"; }

# Timestamp the NEXT mined block will carry.
#
# anvil stamps each new block with max(parent.timestamp + 1, wall clock). Reading
# only `block latest` is wrong after the chain sits idle: the last block may be
# minutes old, so a deadline computed as latest + 30 lands at a timestamp the very
# next block has already passed and createRoom reverts BadDeadlines(). That is
# exactly what happened on a harness run that began after an idle gap.
block_ts() {
  local latest now
  latest="$(c block latest --field timestamp --rpc-url "$RPC_URL")"
  now="$(date +%s)"
  if bn gt "$now" "$latest"; then printf '%s' "$now"; else printf '%s' "$(bn add "$latest" 1)"; fi
}

mine() { c rpc anvil_mine "${1:-1}" --rpc-url "$RPC_URL" >/dev/null; }

warp() {
  local secs="$1"
  c rpc anvil_increaseTime "$secs" --rpc-url "$RPC_URL" >/dev/null
  mine 1
}

# anvil_setBalance wants a JSON number and rejects >u128 decimals, so pass hex.
fund_addr() {
  c rpc anvil_setBalance "$1" "$(bn hex "$2")" --rpc-url "$RPC_URL" >/dev/null
}

balance_of() { c balance "$1" --rpc-url "$RPC_URL"; }

lower() { printf '%s' "$1" | tr 'A-F' 'a-f'; }

# Decode a right-padded ASCII bytes32 (cancelReason) back to text.
bascii() { c to-ascii "$1" 2>/dev/null | tr -d '\0[:space:]'; }

# ---------------------------------------------------------------------------
# Contract reads
# ---------------------------------------------------------------------------

room_json() {
  c call --json --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "$GET_ROOM_SIG" "$1" | jq -c '.[0]'
}

room_field() { room_json "$1" | jq -r ".[$2]"; }

deposited() {
  c call --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "hasDeposited(bytes32,address)(bool)" "$1" "$2" | tr -d '[:space:]'
}

refund_withdrawn() {
  c call --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "refundWithdrawn(bytes32,address)(bool)" "$1" "$2" | tr -d '[:space:]'
}

depositors_of() {
  # tr -d '\r' only: on Windows jq emits CRLF, and a swallowed trailing \r
  # becomes part of the address when callers split on newlines.
  c call --json --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "getRoomDepositors(bytes32)(address[])" "$1" \
    | jq -r '.[0][]' | tr -d '\r'
}

# Gas actually paid by a mined transaction, read from its receipt.
gas_cost_of() { # <txHash>
  local r gas price
  r="$(c receipt "$1" --json --rpc-url "$RPC_URL")"
  gas="$(printf '%s' "$r" | jq -r '.gasUsed')"
  price="$(printf '%s' "$r" | jq -r '.effectiveGasPrice')"
  bn mul "$(bn print "$gas")" "$(bn print "$price")"
}

# Role identifiers MUST be read from the contract: keccak256("DEFAULT_ADMIN_ROLE")
# is not bytes32(0) and is not the admin role.
role_hash() { c call --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "$1()(bytes32)" | tr -d '[:space:]'; }

has_role() { # <roleName> <address>
  c call --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "hasRole(bytes32,address)(bool)" \
    "$(role_hash "$1")" "$2" | tr -d '[:space:]'
}

# Plain `cast call` decorates numbers ("1000000000000000 [1e15]"); --json + jq
# gives a bare integer.
read_uint() { c call --json --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" "$1" | jq -r '.[0]'; }

# Count receipt logs with this topic0 that were emitted by the escrow itself.
count_logs() { # <receipt-json> <topic0>
  printf '%s' "$1" | jq -r --arg t "$2" --arg a "$(lower "$ESCROW_ADDRESS")" \
    '[.logs[] | select((.topics[0]|ascii_downcase)==($t|ascii_downcase))
             | select((.address|ascii_downcase)==$a)] | length'
}

# Count receipt logs matching topic0 whose indexed topic[index] is <value>
# (an address or bytes32). Indexed addresses are 32-byte left-padded, so the
# comparison is done on the last 40 hex characters.
count_logs_topic() { # <receipt-json> <topic0> <topicIndex> <value>
  printf '%s' "$1" | jq -r --arg t "$2" --arg a "$(lower "$ESCROW_ADDRESS")" \
    --arg i "$3" --arg v "$(lower "${4#0x}")" \
    '[.logs[] | select((.topics[0]|ascii_downcase)==($t|ascii_downcase))
             | select((.address|ascii_downcase)==$a)
             | select((.topics[$i|tonumber]|ascii_downcase|.[-40:])==$v)] | length'
}

# ---------------------------------------------------------------------------
# Assertions — each returns non-zero on failure so callers can collect them.
# ---------------------------------------------------------------------------

assert_eq() { # <label> <actual> <expected>
  if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — got '$2', expected '$3'"; return 1; fi
}

assert_wei_eq() { # <label> <actual> <expected>
  if bn eq "$2" "$3"; then
    ok "$1 ($2 wei)"
  else
    bad "$1 — got '$2' wei, expected '$3' wei (delta $(bn sub "$2" "$3"))"; return 1
  fi
}

assert_status() { # <label> <roomKey> <expectedOrdinal>
  assert_eq "$1 status" "$(room_field "$2" "$R_STATUS")" "$3"
}

# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
#
# Every send goes through tx(), which appends the receipt to $TX_LOG so
# check-balance-conservation.sh can recompute gas from chain data alone.
#
#   tx <label> <pk> <to> [cast send args...]
#
# Sets TX_HASH and TX_REVERTED. Fails on a mined-but-reverted tx unless
# ALLOW_REVERT=1.

# shellcheck disable=SC2034
TX_LOG="${TX_LOG:-}"
TX_HASH=""
TX_REVERTED=0
ALLOW_REVERT=0
# shellcheck disable=SC2034
REVERT_GAS_LIMIT="${REVERT_GAS_LIMIT:-500000}"

tx() {
  local label="$1" pk="$2" to="$3"; shift 3
  local js
  if ! js="$(c send --json --rpc-url "$RPC_URL" --private-key "$pk" "$to" "$@" 2>/tmp/e2e-tx.err)"; then
    # A revert that fails gas estimation never reaches the chain. Re-send with an
    # explicit limit so the transaction is really mined and really reverts.
    if ! js="$(c send --json --rpc-url "$RPC_URL" --private-key "$pk" \
                 --gas-limit "$REVERT_GAS_LIMIT" "$to" "$@" 2>/tmp/e2e-tx.err)"; then
      bad "$label — send failed: $(tail -2 /tmp/e2e-tx.err | tr '\n' ' ')"
      return 1
    fi
  fi

  TX_HASH="$(printf '%s' "$js" | jq -r '.transactionHash')"
  local status gas price from
  status="$(printf '%s' "$js" | jq -r '.status')"
  gas="$(printf '%s' "$js" | jq -r '.gasUsed')"
  price="$(printf '%s' "$js" | jq -r '.effectiveGasPrice')"
  from="$(printf '%s' "$js" | jq -r '.from')"

  if [ -n "$TX_LOG" ]; then
    jq -cn --arg label "$label" --arg hash "$TX_HASH" --arg from "$from" \
      --arg to "$to" --arg gasUsed "$gas" --arg price "$price" --arg status "$status" \
      '{label:$label,hash:$hash,from:$from,to:$to,gasUsed:$gasUsed,price:$price,status:$status}' \
      >>"$TX_LOG"
  fi

  TX_REVERTED=0
  if [ "$status" != "0x1" ]; then
    TX_REVERTED=1
    if [ "$ALLOW_REVERT" != "1" ]; then
      bad "$label — transaction reverted on chain (tx $TX_HASH)"
      tail -2 /tmp/e2e-tx.err >&2 || true
      return 1
    fi
  fi
  return 0
}

# A negative check needs two independent proofs:
#   1. eth_call returns the exact custom-error selector (the *reason*), and
#   2. a genuinely mined transaction reverts and changes no state (the *effect*).
revert_call() { # <label> <selector|-> <from> <to> <sig> [args...]
  local label="$1" selector="$2" from="$3" to="$4"; shift 4
  local out rc=0
  out="$(c call --rpc-url "$RPC_URL" --from "$from" "$to" "$@" 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    bad "$label — call unexpectedly SUCCEEDED (returned: $out)"
    return 1
  fi
  if [ "$selector" != "-" ]; then
    case "$out" in
      *"$selector"*) : ;;
      *) bad "$label — reverted, but not with $selector: $out"; return 1 ;;
    esac
  fi
  ok "$label — reverts $selector"
}

revert_tx() { # <label> <pk> <to> <sig> [args...]
  local label="$1" pk="$2" to="$3"; shift 3
  ALLOW_REVERT=1
  if ! tx "$label" "$pk" "$to" "$@"; then ALLOW_REVERT=0; return 1; fi
  ALLOW_REVERT=0
  if [ "$TX_REVERTED" != "1" ]; then
    bad "$label — transaction unexpectedly SUCCEEDED (tx $TX_HASH)"
    return 1
  fi
  ok "$label — mined and reverted (tx $TX_HASH)"
}

sel() { c sig "$1"; }

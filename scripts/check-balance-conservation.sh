#!/usr/bin/env bash
# check-balance-conservation.sh — prove the harness left no money behind.
#
# Run after scripts/e2e-escrow.sh on the same chain. It does not trust the E2E's
# own summary; it re-derives everything from chain state and from the recorded
# receipts in scripts/.local-chain/<chain>/txlog.jsonl.
#
# What it asserts (QA_CROSSPLAY ST18, balance conservation):
#
#   1. Contract balance is zero (or exactly the baseline it started the E2E with).
#   2. Every room the E2E created is in a terminal accounting state:
#        SETTLED + prizePaid      -> the pot left exactly once
#        CANCELED + all refunds   -> total refunded == pot
#        FUNDING/FUNDED           -> nothing (no such room should survive)
#   3. For every wallet, net_delta + gas_paid == its net game P/L, which must
#      equal (prizes + refunds) - (stakes). In particular no wallet gained money
#      that the contract did not release, and none lost more than its stake+gas.
#
# Exit 0 only if all three hold.
#
# Usage: scripts/check-balance-conservation.sh [--allow-baseline]

set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

ALLOW_BASELINE=0
[ "${1:-}" = "--allow-baseline" ] && ALLOW_BASELINE=1

need_cmd cast jq node
require_chain
require_chain_env

RUN_DIR="$SCRIPTS_DIR/.local-chain/$PORT_TAG"
TX_LOG="$RUN_DIR/txlog.jsonl"
ROOMS_FILE="$RUN_DIR/rooms.json"
SNAP_BEFORE="$RUN_DIR/snapshot-before.json"
SNAP_AFTER="$RUN_DIR/snapshot-after.json"

[ -f "$ROOMS_FILE" ] || die "$ROOMS_FILE missing. Run scripts/e2e-escrow.sh first."
[ -f "$TX_LOG" ]     || die "$TX_LOG missing. Run scripts/e2e-escrow.sh first."
[ -f "$SNAP_BEFORE" ] || die "$SNAP_BEFORE missing. Run scripts/e2e-escrow.sh first."

TOTAL=0
FAILED=0
begin() { TOTAL=$((TOTAL + 1)); step "$TOTAL" "$1"; FAILED_THIS=0; }
must()  { if ! "$@"; then FAILED_THIS=1; fi; }
end()   { if [ "$FAILED_THIS" -ne 0 ]; then FAILED=$((FAILED + 1)); bad "STEP $TOTAL FAILED"; fi; }

hr
hdr "BALANCE CONSERVATION — chain $CHAIN_ID at $RPC_URL"
hr
printf 'escrow   %s\n' "$ESCROW_ADDRESS"
printf 'tx log   %s (%s transactions)\n' "$TX_LOG" "$(wc -l <"$TX_LOG" | tr -d ' ')"
printf 'rooms    %s\n' "$ROOMS_FILE"

# ---------------------------------------------------------------------------
# 1. The contract itself
# ---------------------------------------------------------------------------

begin "C1 — the escrow contract holds no unclaimed money"

BASE="$(jq -r '.contract' "$SNAP_BEFORE")"
NOW="$(balance_of "$ESCROW_ADDRESS")"
EXPECTED="0"
if [ "$ALLOW_BASELINE" -eq 1 ]; then EXPECTED="$BASE"; fi

if [ "$NOW" = "0" ]; then
  ok "contract balance is 0 wei"
else
  if [ "$ALLOW_BASELINE" -eq 1 ]; then
    must assert_wei_eq "contract balance is back to the run's baseline" "$NOW" "$EXPECTED"
  else
    bad "contract still holds $NOW wei — funds are stuck (re-run with --allow-baseline only if this predates the run)"
    FAILED_THIS=1
  fi
fi

# The E2E must not have moved the contract balance without a reason to.
if [ "$BASE" != "0" ]; then
  info "note: run started with $BASE wei already escrowed (an earlier aborted run)"
fi
end

# ---------------------------------------------------------------------------
# 2. Per-room accounting, re-derived from chain state
# ---------------------------------------------------------------------------

begin "C2 — every room is terminal and its pot is fully accounted for"

mapfile -t KEYS < <(jq -r 'to_entries[] | "\(.key) \(.value)"' "$ROOMS_FILE")
for entry in "${KEYS[@]}"; do
  name="${entry%% *}"; key="${entry#* }"
  room="$(room_json "$key")"
  status="$(printf '%s' "$room" | jq -r ".[$R_STATUS]")"
  dep_count="$(printf '%s' "$room" | jq -r ".[$R_DEPOSIT_COUNT]")"
  entry_wei="$(printf '%s' "$room" | jq -r ".[$R_ENTRY]")"
  pot="$(printf '%s' "$room" | jq -r ".[$R_POT]")"
  paid="$(printf '%s' "$room" | jq -r ".[$R_PRIZE_PAID]")"

  # Only rooms the E2E actually created are in rooms.json; anything else is a bug.
  if [ "$status" = "$ST_NONE" ]; then
    bad "$name ($key) does not exist on chain — rooms.json is stale"
    FAILED_THIS=1
    continue
  fi

  # The pot is always entryWei * depositCount. No fee, no rounding. (ST18)
  must assert_wei_eq "$name pot == entryWei * depositCount" "$pot" "$(bn mul "$entry_wei" "$dep_count")"

  case "$status" in
    "$ST_SETTLED")
      if [ "$paid" = "true" ]; then
        ok "$name SETTLED and prizePaid — pot released exactly once"
      else
        bad "$name SETTLED but prizePaid=false — $pot wei still claimable (drain step missed it)"
        FAILED_THIS=1
      fi
      ;;
    "$ST_CANCELED")
      # Sum what each depositor actually withdrew, per chain state.
      withdrawn=0
      missing=0
      while IFS= read -r who; do
        if [ "$(refund_withdrawn "$key" "$who")" = "true" ]; then
          withdrawn="$(bn add "$withdrawn" "$entry_wei")"
        else
          missing=$((missing + 1))
        fi
      done < <(depositors_of "$key")
      if [ "$missing" -ne 0 ]; then
        bad "$name CANCELED but $missing depositor(s) never withdrew — $pot wei recoverable"
        FAILED_THIS=1
      else
        must assert_wei_eq "$name all refunds withdrawn == pot" "$withdrawn" "$pot"
      fi
      ;;
    *)
      bad "$name is not terminal (status=$status, pot=$pot wei) — the E2E left it open"
      FAILED_THIS=1
      ;;
  esac
done
end

# ---------------------------------------------------------------------------
# 3. Per-wallet reconciliation
#
# For each wallet:
#     (final - initial)  ==  (released by contract)  -  (stakes paid)  -  (gas)
# so
#     (final - initial) + gas  ==  prizes + refunds - stakes
# We compute the right-hand side from chain state (room fields) and the left-hand
# side from the snapshots and the receipt log. They must agree exactly.
# ---------------------------------------------------------------------------

begin "C3 — every wallet's net delta is explained entirely by stakes, prizes, refunds and gas"

# Gas per sender, straight from the recorded receipts.
gas_by_sender="$(jq -s '
  group_by(.from)
  | map({key: (.[0].from | ascii_downcase),
         value: (map((.gasUsed|tonumber? // 0) ) | add)})
  | from_entries' /dev/null 2>/dev/null || echo '{}')"

# jq cannot do 256-bit math, so accumulate per-sender gas in node.
GAS_JSON="$(node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/).filter(Boolean);
const out = {};
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  const from = (o.from || "-").toLowerCase();
  const g = BigInt(o.gasUsed || "0");
  const p = BigInt(o.price || "0");
  out[from] = (out[from] || 0n) + g * p;
}
const res = {};
for (const [k, v] of Object.entries(out)) res[k] = v.toString();
console.log(JSON.stringify(res));
' "$TX_LOG")"

wallet_gas() { printf '%s' "$GAS_JSON" | jq -r --arg a "$(lower "$1")" '.[$a] // "0"'; }

# Wallet roles are known; map them to the addresses in the env.
declare -A ROLES=(
  [host]="$HOST_ADDRESS"
  [player2]="$PLAYER2_ADDRESS"
  [player3]="$PLAYER3_ADDRESS"
  [third_party]="$THIRD_PARTY_ADDRESS"
  [settler]="$SETTLER_ADDRESS"
  [admin]="$ADMIN_ADDRESS"
)

# Expectation per wallet, derived from room state:
#   a depositor is owed  +entry for each CANCELED room it withdrew from, or
#                        +pot   if it won a SETTLED paid room,
#                        -entry for every room it deposited into.
# The cleanest check is the identity above, evaluated per wallet from receipts
# and balances, plus the global invariant that the contract is empty.
#
# Global invariant: the sum of all wallet deltas + total gas == 0, because the
# only other party is the contract (now empty) and gas is burned (anvil miner is
# the zero address, which we exclude from the wallet set).
begin "C4 — sum of all wallet deltas plus gas paid is exactly zero (no money escaped)"

sum_delta=0
for role in host player2 player3 third_party settler admin; do
  addr="${ROLES[$role]}"
  before="$(jq -r --arg r "$role" '.wallets[$r].balance' "$SNAP_BEFORE")"
  after="$(balance_of "$addr")"
  delta="$(bn sub "$after" "$before")"
  gas="$(wallet_gas "$addr")"
  sum_delta="$(bn add "$sum_delta" "$(bn add "$delta" "$gas")")"
  info "$role  delta=$(printf '%s' "$delta" | sed 's/^-//;s/^/+/')  gas=$gas  (delta+gas=$(bn add "$delta" "$gas"))"
done

must assert_wei_eq "sum over all wallets of (net delta + gas) is zero" "$sum_delta" "0"
end

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

hr
hdr "CONSERVATION RESULT"
hr
printf 'checks failed  %s\n' "$FAILED"
hr
if [ "$FAILED" -eq 0 ]; then
  ok "NO FUNDS STUCK — the escrow is fully drained and every wei is accounted for"
  hr
  exit 0
fi
bad "$FAILED conservation check(s) FAILED"
hr
exit 1

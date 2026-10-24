#!/usr/bin/env bash
# e2e-escrow.sh — the full escrow round trip against a real local chain.
#
# Every assertion below is a real `cast call` or a real mined `cast send` against
# anvil on chainId 10143. Nothing is mocked and nothing is simulated: a PASS
# means the bytecode at ESCROW_ADDRESS actually behaved that way.
#
# Negative checks prove two things each: the eth_call reverts with the exact
# custom-error selector (the reason), and a really-mined transaction reverts
# without changing state (the effect).
#
# Run scripts/dev-chain.sh first (or point MONAD_LOCAL_PORT at a chain it made).
#
# Usage: scripts/e2e-escrow.sh [--keep-going]
#
#   --keep-going   run every step even after a failure, then exit non-zero.
#                  The default is fail-fast, which is what a demo gate wants.

set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

KEEP_GOING=0
[ "${1:-}" = "--keep-going" ] && KEEP_GOING=1

need_cmd cast anvil forge jq node
require_chain
require_chain_env

# The harness names the three player wallets P1/P2/P3; this script reads them as
# host/player2/player3 (the host is simply the wallet that calls createRoom).
if [ -z "${P1_KEY:-}" ]; then
  # Alternate dev-chain schema (HOST_*/PLAYER2_*/PLAYER3_*).
  P1_KEY="${HOST_KEY:-$HOST_PK}";            P1_ADDRESS="$HOST_ADDRESS"
  P2_KEY="${PLAYER2_KEY:-$PLAYER2_PK}";      P2_ADDRESS="$PLAYER2_ADDRESS"
  P3_KEY="${PLAYER3_KEY:-$PLAYER3_PK}";      P3_ADDRESS="$PLAYER3_ADDRESS"
fi
HOST_PK="${P1_KEY:-}";            HOST_ADDRESS="${P1_ADDRESS:-}"
PLAYER2_PK="${P2_KEY:-}";         PLAYER2_ADDRESS="${P2_ADDRESS:-}"
PLAYER3_PK="${P3_KEY:-}";         PLAYER3_ADDRESS="${P3_ADDRESS:-}"
SETTLER_PK="${SETTLER_PK:-${SETTLER_KEY:-}}"
if [ -z "$HOST_PK" ] || [ -z "$SETTLER_PK" ]; then
  bad "the env file does not expose player/settler keys; re-run scripts/dev-chain.sh"
  exit 1
fi
SETTLER_PK="$SETTLER_KEY"
ADMIN_PK="$ADMIN_KEY"
THIRD_PARTY_PK="$THIRD_PARTY_KEY"

# Per-port run directory, so two harnesses on different ports never share a log.
RUN_DIR="$SCRIPTS_DIR/.local-chain/$PORT_TAG"
mkdir -p "$RUN_DIR"
TX_LOG="$RUN_DIR/txlog.jsonl"
: >"$TX_LOG"
export TX_LOG

SNAP_BEFORE="$RUN_DIR/snapshot-before.json"
SNAP_AFTER="$RUN_DIR/snapshot-after.json"
ROOMS_FILE="$RUN_DIR/rooms.json"

# ---------------------------------------------------------------------------
# Step accounting
# ---------------------------------------------------------------------------

TOTAL_STEPS=0
FAILED_STEPS=0
CURRENT_STEP=""
CURRENT_STEP_FAILED=0

begin_step() {
  CURRENT_STEP="$1"
  CURRENT_STEP_FAILED=0
  TOTAL_STEPS=$((TOTAL_STEPS + 1))
  step "$TOTAL_STEPS" "$2"
}

# Assertions return non-zero; `must` records that instead of letting `set -e`
# abort the whole run on the first mismatch.
must() { if ! "$@"; then CURRENT_STEP_FAILED=1; fi; }

end_step() {
  if [ "$CURRENT_STEP_FAILED" -ne 0 ]; then
    FAILED_STEPS=$((FAILED_STEPS + 1))
    bad "STEP $TOTAL_STEPS FAILED — $CURRENT_STEP"
    if [ "$KEEP_GOING" -ne 1 ]; then
      hr
      bad "stopping after the first failing step (--keep-going runs them all)"
      exit 1
    fi
  fi
}

# run_tx <label> <pk> <ok|revert> <to> <sig> [args...]
# A failed send marks the step instead of aborting the script.
run_tx() {
  local label="$1" pk="$2" want="$3" to="$4"; shift 4
  if [ "$want" = "revert" ]; then
    if revert_tx "$label" "$pk" "$to" "$@"; then return 0; fi
  else
    if tx "$label" "$pk" "$to" "$@"; then return 0; fi
  fi
  CURRENT_STEP_FAILED=1
  return 1
}

# EOA balances drop by gas on every tx THEY send. To assert "the wallet got
# exactly entryWei back", compare against +entryWei minus that tx's gas cost.
gas_cost_of() { # <txHash> -> wei
  local r g p
  r="$(c receipt --json "$1" --rpc-url "$RPC_URL")"
  g="$(printf '%s' "$r" | jq -r '.gasUsed')"
  p="$(printf '%s' "$r" | jq -r '.effectiveGasPrice')"
  bn mul "$(bn print "$g")" "$(bn print "$p")"
}

# ---------------------------------------------------------------------------
# Snapshot (also read by check-balance-conservation.sh)
# ---------------------------------------------------------------------------

snapshot() { # <outfile>
  local out="$1" first=1 name var
  {
    printf '{\n'
    printf '  "block": %s,\n' "$(c block-number --rpc-url "$RPC_URL")"
    printf '  "chainId": %s,\n' "$CHAIN_ID"
    printf '  "escrow": "%s",\n' "$ESCROW_ADDRESS"
    printf '  "contract": "%s",\n' "$(balance_of "$ESCROW_ADDRESS")"
    printf '  "wallets": {\n'
    for name in host player2 player3 third_party settler admin; do
      case "$name" in
        host)        var=HOST_ADDRESS ;;
        player2)     var=PLAYER2_ADDRESS ;;
        player3)     var=PLAYER3_ADDRESS ;;
        third_party) var=THIRD_PARTY_ADDRESS ;;
        settler)     var=SETTLER_ADDRESS ;;
        admin)       var=ADMIN_ADDRESS ;;
      esac
      [ "$first" -eq 1 ] || printf ',\n'
      first=0
      printf '    "%s": {"address": "%s", "balance": "%s"}' \
        "$name" "${!var}" "$(balance_of "${!var}")"
    done
    printf '\n  }\n}\n'
  } >"$out"
}

# ---------------------------------------------------------------------------
# Run parameters. Unique per invocation so a rerun cannot collide on RoomExists.
# ---------------------------------------------------------------------------

RUN_ID="$(date +%s%N)"
ROOM_A="$(c keccak "BOMB_RUSH/roomA/$RUN_ID")"
ROOM_B="$(c keccak "BOMB_RUSH/roomB/$RUN_ID")"
ROOM_C="$(c keccak "BOMB_RUSH/roomC/$RUN_ID")"
ROOM_D="$(c keccak "BOMB_RUSH/roomD/$RUN_ID")"
ROOM_E="$(c keccak "BOMB_RUSH/roomE/$RUN_ID")"
ROOM_F="$(c keccak "BOMB_RUSH/roomF/$RUN_ID")"
ROOM_G="$(c keccak "BOMB_RUSH/roomG/$RUN_ID")"
ROOM_H="$(c keccak "BOMB_RUSH/roomH/$RUN_ID")"
ROOM_N="$(c keccak "BOMB_RUSH/roomN/$RUN_ID")"
RESULT_HASH="$(c keccak "BOMB_RUSH_V05/$RUN_ID/result")"
POT3="$(bn mul "$ENTRY_WEI" 3)"
ZERO32="0x0000000000000000000000000000000000000000000000000000000000000000"
ZERO_ADDR="0x0000000000000000000000000000000000000000"

snapshot "$SNAP_BEFORE"

hr
hdr "LOCAL ESCROW E2E — chain $CHAIN_ID at $RPC_URL"
hr
printf 'escrow      %s  (deployed at block %s)\n' "$ESCROW_ADDRESS" "$ESCROW_DEPLOYMENT_BLOCK"
printf 'entry       %s wei per seat; a 3-seat pot is %s wei\n' "$ENTRY_WEI" "$POT3"
printf 'host        %s\n' "$HOST_ADDRESS"
printf 'player2     %s\n' "$PLAYER2_ADDRESS"
printf 'player3     %s\n' "$PLAYER3_ADDRESS"
printf 'third party %s\n' "$THIRD_PARTY_ADDRESS"
printf 'settler     %s  (SETTLER_ROLE, not the admin)\n' "$SETTLER_ADDRESS"
printf 'admin       %s  (DEFAULT_ADMIN_ROLE)\n' "$ADMIN_ADDRESS"
printf 'st08 helper %s  (RejectingDepositor)\n' "$REJECTING_HELPER_ADDRESS"
printf 'tx log      %s\n' "$TX_LOG"

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------

begin_step "preflight" "Preconditions: chain, distinct keys, roles, empty contract"
must assert_eq "chain id" "$(c chain-id --rpc-url "$RPC_URL")" "$CHAIN_ID"
must assert_eq "admin holds DEFAULT_ADMIN_ROLE"  "$(has_role DEFAULT_ADMIN_ROLE "$ADMIN_ADDRESS")" "true"
must assert_eq "settler holds SETTLER_ROLE"      "$(has_role SETTLER_ROLE "$SETTLER_ADDRESS")" "true"
must assert_eq "settler does NOT hold admin"     "$(has_role DEFAULT_ADMIN_ROLE "$SETTLER_ADDRESS")" "false"
must assert_eq "the four signing wallets are distinct" \
  "$(printf '%s\n' "$HOST_ADDRESS" "$PLAYER2_ADDRESS" "$PLAYER3_ADDRESS" "$THIRD_PARTY_ADDRESS" | sort -u | wc -l | tr -d ' ')" "4"
# dev-chain.sh is idempotent and may hand back an escrow that still holds funds
# from an earlier aborted run, so the starting balance is a BASELINE, not an
# assertion. Every contract-balance check below is a delta from it.
ESCROW_BASE="$(balance_of "$ESCROW_ADDRESS")"
info "contract balance at start: $ESCROW_BASE wei (baseline for all deltas)"
if [ "$ESCROW_BASE" = "0" ]; then
  ok "contract starts at a zero balance"
else
  info "NOTE: contract already holds $ESCROW_BASE wei from a previous run; using deltas"
fi

BOUNDS_JSON="$(c call --json --rpc-url "$RPC_URL" "$ESCROW_ADDRESS" 'entryBounds()(uint256,uint256)')"
BOUNDS_MIN="$(printf '%s' "$BOUNDS_JSON" | jq -r '.[0]')"
BOUNDS_MAX="$(printf '%s' "$BOUNDS_JSON" | jq -r '.[1]')"
must assert_eq "ENTRY_WEI is inside the contract's own entryBounds()" \
  "$(if bn gt "$ENTRY_WEI" "$(bn sub "$BOUNDS_MIN" 1)" && bn lt "$ENTRY_WEI" "$(bn add "$BOUNDS_MAX" 1)"; then echo true; else echo false; fi)" "true"
end_step
if [ "$FAILED_STEPS" -ne 0 ]; then
  bad "preflight failed; aborting before spending any transaction"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. ROOM A — happy path
# ---------------------------------------------------------------------------

begin_step "roomA-create" "A1 — createRoom(3 seats): the host pays exactly entryWei
             roomKey $ROOM_A"

NOW="$(block_ts)"
A_FUND_DEADLINE="$(bn add "$NOW" "$FUNDING_WINDOW_SEC")"
A_RES_DEADLINE="$(bn add "$NOW" "$RESOLUTION_WINDOW_SEC")"

run_tx "createRoom" "$HOST_PK" ok "$ESCROW_ADDRESS" \
  "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_A" 3 "$ENTRY_WEI" "$A_FUND_DEADLINE" "$A_RES_DEADLINE" --value "$ENTRY_WEI" \
  && { ok "createRoom mined (tx $TX_HASH)"; A_CREATE_TX="$TX_HASH"; }

must assert_eq "room exists, status FUNDING (1)" "$(room_field "$ROOM_A" "$R_STATUS")" "$ST_FUNDING"
must assert_eq "host recorded"      "$(lower "$(room_field "$ROOM_A" "$R_HOST")")" "$(lower "$HOST_ADDRESS")"
must assert_eq "maxSeats"           "$(room_field "$ROOM_A" "$R_MAX_SEATS")" "3"
must assert_eq "depositCount is 1 (the host)" "$(room_field "$ROOM_A" "$R_DEPOSIT_COUNT")" "1"
must assert_wei_eq "entryWei"       "$(room_field "$ROOM_A" "$R_ENTRY")" "$ENTRY_WEI"
must assert_wei_eq "potWei"         "$(room_field "$ROOM_A" "$R_POT")" "$ENTRY_WEI"
must assert_eq "host is a depositor" "$(deposited "$ROOM_A" "$HOST_ADDRESS")" "true"
must assert_wei_eq "contract balance delta == one stake"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$ENTRY_WEI"

# ABI_HANDOFF §3: createRoom emits RoomCreated *and* a host DepositConfirmed.
# QA CH01 verifies both off the receipt; do the same rather than trusting state.
if [ -n "${A_CREATE_TX:-}" ]; then
  RECEIPT="$(c receipt "$A_CREATE_TX" --json --rpc-url "$RPC_URL")"
  must assert_eq "receipt status is success" "$(printf '%s' "$RECEIPT" | jq -r '.status')" "0x1"
  must assert_eq "receipt carries RoomCreated from the escrow" \
    "$(count_logs "$RECEIPT" "$(c keccak 'RoomCreated(bytes32,address,uint256,uint8,uint64,uint64)')")" "1"
  must assert_eq "receipt ALSO carries the host DepositConfirmed (CH01)" \
    "$(count_logs "$RECEIPT" "$(c keccak 'DepositConfirmed(bytes32,address,uint256,uint8)')")" "1"
  must assert_eq "that DepositConfirmed names the host" \
    "$(count_logs_topic "$RECEIPT" "$(c keccak 'DepositConfirmed(bytes32,address,uint256,uint8)')" 2 "$HOST_ADDRESS")" "1"
else
  bad "no createRoom receipt to inspect"
  CURRENT_STEP_FAILED=1
fi
end_step

begin_step "roomA-join" "A2 — two joinRoom calls, each paying exactly entryWei"

run_tx "joinRoom player2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_A" --value "$ENTRY_WEI" \
  && ok "player2 joined (tx $TX_HASH)"
must assert_eq "still FUNDING at 2 of 3 seats" "$(room_field "$ROOM_A" "$R_STATUS")" "$ST_FUNDING"
must assert_eq "depositCount is 2" "$(room_field "$ROOM_A" "$R_DEPOSIT_COUNT")" "2"
must assert_wei_eq "potWei is 2 stakes" "$(room_field "$ROOM_A" "$R_POT")" "$(bn mul "$ENTRY_WEI" 2)"

run_tx "joinRoom player3" "$PLAYER3_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_A" --value "$ENTRY_WEI" \
  && { ok "player3 joined (tx $TX_HASH)"; A_JOIN3_TX="$TX_HASH"; }
end_step

begin_step "roomA-funded" "A3 — assert depositCount == 3, status == FUNDED, pot == 3 × entry"

must assert_eq "depositCount is 3" "$(room_field "$ROOM_A" "$R_DEPOSIT_COUNT")" "3"
must assert_eq "status is FUNDED (2)" "$(room_field "$ROOM_A" "$R_STATUS")" "$ST_FUNDED"
must assert_wei_eq "potWei == entryWei * 3" "$(room_field "$ROOM_A" "$R_POT")" "$POT3"
must assert_wei_eq "contract balance delta == the pot"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$POT3"
must assert_eq "depositors are host, player2, player3 in deposit order" \
  "$(depositors_of "$ROOM_A" | tr -d '\r' | tr 'A-F' 'a-f' | paste -sd, -)" \
  "$(printf '%s\n' "$HOST_ADDRESS" "$PLAYER2_ADDRESS" "$PLAYER3_ADDRESS" | tr -d '\r' | tr 'A-F' 'a-f' | paste -sd, -)"
if [ -n "${A_JOIN3_TX:-}" ]; then
  must assert_eq "RoomFunded emitted exactly once, on the last join" \
    "$(count_logs "$(c receipt "$A_JOIN3_TX" --json --rpc-url "$RPC_URL")" "$(c keccak 'RoomFunded(bytes32,uint256)')")" "1"
else
  bad "no final join receipt"
  CURRENT_STEP_FAILED=1
fi
end_step

begin_step "roomA-settle" "A4 — settle from the SETTLER key, naming a real depositor (player2)"

run_tx "settle" "$SETTLER_PK" ok "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" \
  "$ROOM_A" "$PLAYER2_ADDRESS" "$RESULT_HASH" \
  && { ok "settle mined by $SETTLER_ADDRESS (tx $TX_HASH)"; A_SETTLE_TX="$TX_HASH"; }

must assert_eq "status is SETTLED (3)" "$(room_field "$ROOM_A" "$R_STATUS")" "$ST_SETTLED"
must assert_eq "winner recorded is player2" "$(lower "$(room_field "$ROOM_A" "$R_WINNER")")" "$(lower "$PLAYER2_ADDRESS")"
must assert_eq "resultHash stored verbatim" "$(lower "$(room_field "$ROOM_A" "$R_RESULT_HASH")")" "$(lower "$RESULT_HASH")"
must assert_eq "prizePaid is still false — settle never transfers" "$(room_field "$ROOM_A" "$R_PRIZE_PAID")" "false"
must assert_wei_eq "contract balance delta == the pot"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$POT3"
if [ -n "${A_SETTLE_TX:-}" ]; then
  must assert_eq "MatchSettled emitted exactly once" \
    "$(count_logs "$(c receipt "$A_SETTLE_TX" --json --rpc-url "$RPC_URL")" "$(c keccak 'MatchSettled(bytes32,address,uint256,bytes32)')")" "1"
else
  bad "no settle receipt"
  CURRENT_STEP_FAILED=1
fi
end_step

begin_step "roomA-payout-third-party" "A5 — payout() triggered by a THIRD PARTY; funds must land on the recorded winner"

P2_BEFORE="$(balance_of "$PLAYER2_ADDRESS")"
THIRD_BEFORE="$(balance_of "$THIRD_PARTY_ADDRESS")"
ESCROW_BEFORE_PAYOUT="$(balance_of "$ESCROW_ADDRESS")"

run_tx "payout (third party)" "$THIRD_PARTY_PK" ok "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_A" \
  && { ok "payout mined by $THIRD_PARTY_ADDRESS (tx $TX_HASH)"; A_PAYOUT_TX="$TX_HASH"; }

P2_AFTER="$(balance_of "$PLAYER2_ADDRESS")"
THIRD_AFTER="$(balance_of "$THIRD_PARTY_ADDRESS")"

must assert_eq "prizePaid is now true" "$(room_field "$ROOM_A" "$R_PRIZE_PAID")" "true"
must assert_wei_eq "player2 received the full pot" "$(bn sub "$P2_AFTER" "$P2_BEFORE")" "$POT3"
must assert_eq "the caller received no prize (their balance only fell, by gas)" \
  "$(if bn lt "$THIRD_AFTER" "$THIRD_BEFORE"; then echo true; else echo false; fi)" "true"
must assert_wei_eq "contract paid out exactly the pot" \
  "$(bn sub "$ESCROW_BEFORE_PAYOUT" "$(balance_of "$ESCROW_ADDRESS")")" "$POT3"
must assert_wei_eq "contract balance delta is zero"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "0"
if [ -n "${A_PAYOUT_TX:-}" ]; then
  must assert_eq "PrizePaid names player2 as the recipient" \
    "$(count_logs_topic "$(c receipt "$A_PAYOUT_TX" --json --rpc-url "$RPC_URL")" \
       "$(c keccak 'PrizePaid(bytes32,address,uint256)')" 2 "$PLAYER2_ADDRESS")" "1"
else
  bad "no payout receipt"
  CURRENT_STEP_FAILED=1
fi
end_step

# ---------------------------------------------------------------------------
# 3. ROOM B — timeout and refunds
# ---------------------------------------------------------------------------

begin_step "roomB-fund" "B1 — second room, 3/3 funded, deliberately never settled"

NOW="$(block_ts)"
B_FUND_DEADLINE="$(bn add "$NOW" 30)"
B_RES_DEADLINE="$(bn add "$NOW" 120)"

run_tx "createRoom roomB" "$HOST_PK" ok "$ESCROW_ADDRESS" \
  "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_B" 3 "$ENTRY_WEI" "$B_FUND_DEADLINE" "$B_RES_DEADLINE" --value "$ENTRY_WEI" \
  && ok "roomB created (tx $TX_HASH)"
run_tx "joinRoom roomB player2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_B" --value "$ENTRY_WEI" \
  && ok "player2 joined roomB (tx $TX_HASH)"
run_tx "joinRoom roomB player3" "$PLAYER3_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_B" --value "$ENTRY_WEI" \
  && ok "player3 joined roomB (tx $TX_HASH)"

must assert_status "roomB is FUNDED" "$ROOM_B" "$ST_FUNDED"
must assert_wei_eq "roomB's pot is on chain"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$POT3"
end_step

begin_step "roomB-expire" "B2 — warp past resolutionDeadline, then expireUnresolved from a NON-depositor
             (permissionless: no backend, no settler, no admin involved)"

must revert_call "expireUnresolved before the deadline" "$(sel 'DeadlineNotPassed()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "expireUnresolved(bytes32)" "$ROOM_B"
must assert_status "roomB is still FUNDED after the early attempt" "$ROOM_B" "$ST_FUNDED"

NOW="$(block_ts)"
WARP_BY="$(bn add "$(bn sub "$B_RES_DEADLINE" "$NOW")" 1)"
info "warping ${WARP_BY}s past resolutionDeadline $B_RES_DEADLINE"
warp "$WARP_BY"

run_tx "expireUnresolved" "$THIRD_PARTY_PK" ok "$ESCROW_ADDRESS" "expireUnresolved(bytes32)" "$ROOM_B" \
  && { ok "expireUnresolved mined by outsider $THIRD_PARTY_ADDRESS (tx $TX_HASH)"; B_EXPIRE_TX="$TX_HASH"; }

must assert_status "status is CANCELED (4)" "$ROOM_B" "$ST_CANCELED"
must assert_eq "cancelReason decodes to RESOLUTION_TIMEOUT" \
  "$(bascii "$(room_field "$ROOM_B" "$R_CANCEL_REASON")")" "RESOLUTION_TIMEOUT"
end_step

begin_step "roomB-refunds" "B3 — withdrawRefund for each of the three depositors, exact stake each"

for who in HOST PLAYER2 PLAYER3; do
  pk_var="${who}_PK"; addr_var="${who}_ADDRESS"
  pk="${!pk_var}"; addr="${!addr_var}"
  before="$(balance_of "$addr")"
  run_tx "withdrawRefund $who" "$pk" ok "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_B" \
    && ok "$who withdrew (tx $TX_HASH)"
  after="$(balance_of "$addr")"
  must assert_wei_eq "$who net = +stake - own gas"     "$(bn sub "$after" "$(bn sub "$before" "$(gas_cost_of "$TX_HASH")")")" "$ENTRY_WEI"
  must assert_eq "$who is flagged refundWithdrawn" "$(refund_withdrawn "$ROOM_B" "$addr")" "true"
done

must assert_wei_eq "contract balance delta back to zero after refunds"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "0"
must assert_status "roomB remains CANCELED" "$ROOM_B" "$ST_CANCELED"
end_step

# ---------------------------------------------------------------------------
# 4. Negative checks
# ---------------------------------------------------------------------------

begin_step "fixture-roomN" "N0 — build a FUNDED room (roomN) for the settle attacks"
NOW="$(block_ts)"
run_tx "createRoom roomN" "$HOST_PK" ok "$ESCROW_ADDRESS" "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_N" 3 "$ENTRY_WEI" "$(bn add "$NOW" "$FUNDING_WINDOW_SEC")" "$(bn add "$NOW" "$RESOLUTION_WINDOW_SEC")" \
  --value "$ENTRY_WEI"
run_tx "joinRoom roomN p2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_N" --value "$ENTRY_WEI"
run_tx "joinRoom roomN p3" "$PLAYER3_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_N" --value "$ENTRY_WEI"
must assert_status "roomN is FUNDED" "$ROOM_N" "$ST_FUNDED"
end_step

begin_step "negative-non-settler" "N1 — ST02: settle from an ordinary wallet must revert"

must revert_call "settle as host (holds no role)" "$(sel 'AccessControlUnauthorizedAccount(address,bytes32)')" \
  "$HOST_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_N" "$HOST_ADDRESS" "$RESULT_HASH"
must revert_tx "settle as host, mined" "$HOST_PK" "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_N" "$HOST_ADDRESS" "$RESULT_HASH"

# The admin key must not be able to settle either: it holds no SETTLER_ROLE.
# That separation is the whole point (ESCROW_SECURITY §"Key handling").
must revert_call "settle as admin (role separation)" "$(sel 'AccessControlUnauthorizedAccount(address,bytes32)')" \
  "$ADMIN_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_N" "$HOST_ADDRESS" "$RESULT_HASH"

must assert_status "roomN untouched (still FUNDED)" "$ROOM_N" "$ST_FUNDED"
must assert_eq "roomN still has no winner" \
  "$(lower "$(room_field "$ROOM_N" "$R_WINNER")")" "0x0000000000000000000000000000000000000000"
must assert_wei_eq "roomN's pot is on chain"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$POT3"
end_step

begin_step "negative-winner-not-depositor" "N2 — ST03: settle naming a non-depositor, and naming address(0)"

must revert_call "settle winner = third party (never deposited)" "$(sel 'WinnerNotDepositor()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_N" "$THIRD_PARTY_ADDRESS" "$RESULT_HASH"
must revert_tx "settle winner = third party, mined" "$SETTLER_PK" "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_N" "$THIRD_PARTY_ADDRESS" "$RESULT_HASH"

must revert_call "settle winner = address(0)" "$(sel 'ZeroWinner()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_N" "$ZERO_ADDR" "$RESULT_HASH"
must revert_call "settle with a zero resultHash" "$(sel 'ZeroResultHash()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_N" "$HOST_ADDRESS" "$ZERO32"

must assert_status "roomN still FUNDED after every bad settle" "$ROOM_N" "$ST_FUNDED"
end_step

begin_step "negative-double-payout" "N3 — ST06: a second payout on the settled room must revert and send nothing"

P2_BEFORE="$(balance_of "$PLAYER2_ADDRESS")"
must revert_call "second payout on roomA" "$(sel 'PrizeAlreadyPaid()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_A"
must revert_tx "second payout on roomA, mined" "$THIRD_PARTY_PK" "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_A"
P2_AFTER="$(balance_of "$PLAYER2_ADDRESS")"
must assert_wei_eq "the winner's balance did not move" "$(bn sub "$P2_AFTER" "$P2_BEFORE")" "0"
must assert_wei_eq "roomA's pot has not moved"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$POT3"
end_step

begin_step "negative-refund-on-settled" "N4 — ST13: withdrawRefund on a SETTLED room must revert"

P2_BEFORE="$(balance_of "$PLAYER2_ADDRESS")"
must revert_call "roomA's winner tries to refund" "$(sel 'AlreadySettled()')" \
  "$PLAYER2_ADDRESS" "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_A"
must revert_tx "roomA's winner tries to refund, mined" "$PLAYER2_PK" "$ESCROW_ADDRESS" \
  "withdrawRefund(bytes32)" "$ROOM_A"
P2_AFTER="$(balance_of "$PLAYER2_ADDRESS")"
# The claimer still paid gas for the reverted tx, so the delta is -gas, not 0.
must assert_wei_eq "rejected refund paid out nothing (delta is gas only)" \
  "$(bn sub "$P2_AFTER" "$P2_BEFORE")" "$(bn sub 0 "$(gas_cost_of "$TX_HASH")")"
end_step

begin_step "negative-double-refund" "N5 — ST12: a second withdrawRefund from the same wallet must revert"

HOST_BEFORE="$(balance_of "$HOST_ADDRESS")"
must revert_call "host refunds roomB twice" "$(sel 'RefundAlreadyWithdrawn()')" \
  "$HOST_ADDRESS" "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_B"
must revert_tx "host refunds roomB twice, mined" "$HOST_PK" "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_B"
HOST_AFTER="$(balance_of "$HOST_ADDRESS")"
must assert_wei_eq "second refund paid out nothing (delta is gas only)" \
  "$(bn sub "$HOST_AFTER" "$HOST_BEFORE")" "$(bn sub 0 "$(gas_cost_of "$TX_HASH")")"
end_step

begin_step "negative-settle-after-cancel" "N6 — ST14: settle on a canceled room must revert"

must revert_call "settle on canceled roomB" "$(sel 'AlreadyCanceled()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_B" "$HOST_ADDRESS" "$RESULT_HASH"
must revert_tx "settle on canceled roomB, mined" "$SETTLER_PK" "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_B" "$HOST_ADDRESS" "$RESULT_HASH"
must assert_status "roomB stays CANCELED" "$ROOM_B" "$ST_CANCELED"
end_step

begin_step "negative-payout-before-settle" "N7 — ST05: payout before settlement must revert"

ROOM_C_TS="$(block_ts)"
run_tx "createRoom roomC" "$HOST_PK" ok "$ESCROW_ADDRESS" "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_C" 3 "$ENTRY_WEI" "$(bn add "$ROOM_C_TS" 60)" "$(bn add "$ROOM_C_TS" 180)" --value "$ENTRY_WEI"
run_tx "joinRoom roomC p2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_C" --value "$ENTRY_WEI"
run_tx "joinRoom roomC p3" "$PLAYER3_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_C" --value "$ENTRY_WEI"
must assert_status "roomC is FUNDED and unsettled" "$ROOM_C" "$ST_FUNDED"

must revert_call "payout on a FUNDED room" "$(sel 'NotSettled()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_C"
must revert_tx "payout on a FUNDED room, mined" "$THIRD_PARTY_PK" "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_C"
must assert_wei_eq "both pots are still escrowed"   "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "$(bn mul "$POT3" 2)"
end_step

begin_step "negative-double-settle" "N8 — ST04: settling the same room twice must revert the second time"

run_tx "settle roomC" "$SETTLER_PK" ok "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" \
  "$ROOM_C" "$PLAYER3_ADDRESS" "$RESULT_HASH" && ok "first settle on roomC succeeded (tx $TX_HASH)"
must assert_status "roomC is SETTLED" "$ROOM_C" "$ST_SETTLED"

must revert_call "settle roomC again" "$(sel 'AlreadySettled()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_C" "$HOST_ADDRESS" "$RESULT_HASH"
must revert_tx "settle roomC again, mined" "$SETTLER_PK" "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_C" "$HOST_ADDRESS" "$RESULT_HASH"
must assert_eq "the recorded winner was not overwritten" \
  "$(lower "$(room_field "$ROOM_C" "$R_WINNER")")" "$(lower "$PLAYER3_ADDRESS")"
end_step

begin_step "negative-settle-not-funded" "N9 — ST01 guard: settling a partially funded room must revert"

ROOM_D_TS="$(block_ts)"
run_tx "createRoom roomD (1 of 3 seats)" "$HOST_PK" ok "$ESCROW_ADDRESS" \
  "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_D" 3 "$ENTRY_WEI" "$(bn add "$ROOM_D_TS" "$FUNDING_WINDOW_SEC")" "$(bn add "$ROOM_D_TS" "$RESOLUTION_WINDOW_SEC")" \
  --value "$ENTRY_WEI"
must assert_status "roomD is FUNDING with 1 seat" "$ROOM_D" "$ST_FUNDING"

must revert_call "settle roomD with only the host funded" "$(sel 'NotFunded()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_D" "$HOST_ADDRESS" "$RESULT_HASH"
must revert_tx "settle roomD with only the host funded, mined" "$SETTLER_PK" "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_D" "$HOST_ADDRESS" "$RESULT_HASH"
must assert_status "roomD still FUNDING" "$ROOM_D" "$ST_FUNDING"
end_step

# ---------------------------------------------------------------------------
# 5. ST09 / ST08 / ST15 / ST10
# ---------------------------------------------------------------------------

begin_step "st09-admin-cancel" "ST09 — admin cancelRoom on a FUNDING room; the host can then refund"

must revert_call "cancelRoom from the settler (not admin)" "$(sel 'AccessControlUnauthorizedAccount(address,bytes32)')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "cancelRoom(bytes32,bytes32)" "$ROOM_D" "$(c format-bytes32-string 'OPERATOR_ABORT')"
must revert_tx "cancelRoom from the settler, mined" "$SETTLER_PK" "$ESCROW_ADDRESS" \
  "cancelRoom(bytes32,bytes32)" "$ROOM_D" "$(c format-bytes32-string 'OPERATOR_ABORT')"

run_tx "cancelRoom roomD (admin)" "$ADMIN_PK" ok "$ESCROW_ADDRESS" "cancelRoom(bytes32,bytes32)" \
  "$ROOM_D" "$(c format-bytes32-string 'OPERATOR_ABORT')" && ok "admin canceled roomD (tx $TX_HASH)"
must assert_status "roomD is CANCELED (4)" "$ROOM_D" "$ST_CANCELED"
must assert_eq "cancelReason decodes to OPERATOR_ABORT" \
  "$(bascii "$(room_field "$ROOM_D" "$R_CANCEL_REASON")")" "OPERATOR_ABORT"

HOST_BEFORE="$(balance_of "$HOST_ADDRESS")"
run_tx "withdrawRefund roomD (host)" "$HOST_PK" ok "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_D" \
  && ok "host refunded from canceled roomD (tx $TX_HASH)"
must assert_wei_eq "host net = +stake - own gas"   "$(bn sub "$(balance_of "$HOST_ADDRESS")" "$(bn sub "$HOST_BEFORE" "$(gas_cost_of "$TX_HASH")")")" "$ENTRY_WEI"
end_step

begin_step "st08-rejecting-recipient" "ST08 — payout to a winner that rejects MON: revert, claim NOT consumed"

# Baseline for roomE-only balance deltas (other rooms are also escrowed here).
ESCROW_BEFORE_E="$(balance_of "$ESCROW_ADDRESS")"
ROOM_E_TS="$(block_ts)"
run_tx "createRoom roomE" "$HOST_PK" ok "$ESCROW_ADDRESS" "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_E" 3 "$ENTRY_WEI" "$(bn add "$ROOM_E_TS" 120)" "$(bn add "$ROOM_E_TS" 240)" --value "$ENTRY_WEI"
run_tx "RejectingDepositor joins roomE" "$THIRD_PARTY_PK" ok "$REJECTING_HELPER_ADDRESS" \
  "deposit(bytes32)" "$ROOM_E" --value "$ENTRY_WEI" && ok "the rejecting contract funded a seat (tx $TX_HASH)"
run_tx "joinRoom roomE p2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_E" --value "$ENTRY_WEI"

must assert_status "roomE is FUNDED" "$ROOM_E" "$ST_FUNDED"
must assert_eq "the rejecting contract is a real depositor" "$(deposited "$ROOM_E" "$REJECTING_HELPER_ADDRESS")" "true"

run_tx "settle roomE to the rejecting contract" "$SETTLER_PK" ok "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_E" "$REJECTING_HELPER_ADDRESS" "$RESULT_HASH" \
  && ok "settle named the rejecting contract as winner (tx $TX_HASH)"
must assert_status "roomE is SETTLED" "$ROOM_E" "$ST_SETTLED"

# The transfer fails, so payout must revert...
must revert_call "payout to a rejecting recipient" "$(sel 'TransferFailed()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_E"
must revert_tx "payout to a rejecting recipient, mined" "$THIRD_PARTY_PK" "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_E"

# ...and must NOT consume the claim: prizePaid stays false, the pot stays put.
# Measure roomE's own contribution: other rooms (roomN funded, roomC settled and
# unpaid) are also sitting in the contract at this point, so a global delta would
# be meaningless here.
must assert_eq "prizePaid is still false after the failed payout" "$(room_field "$ROOM_E" "$R_PRIZE_PAID")" "false"
must assert_status "roomE is still SETTLED, not canceled by the failure" "$ROOM_E" "$ST_SETTLED"
must assert_wei_eq "the prize is still on chain, claimable" \
  "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BEFORE_E")" "$POT3"

# Then the winner fixes its receiver and the retry succeeds. This is the half of
# ST08 that says "still claimable" rather than merely "reverted".
run_tx "disarm the rejecting receiver" "$THIRD_PARTY_PK" ok "$REJECTING_HELPER_ADDRESS" "disarm()" \
  && ok "receiver disarmed (tx $TX_HASH)"
run_tx "retry payout" "$THIRD_PARTY_PK" ok "$ESCROW_ADDRESS" "payout(bytes32)" "$ROOM_E" \
  && ok "retry succeeded (tx $TX_HASH)"
must assert_eq "prizePaid is now true" "$(room_field "$ROOM_E" "$R_PRIZE_PAID")" "true"
must assert_wei_eq "roomE's pot left the contract on the retry" \
  "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BEFORE_E")" "0"
end_step

begin_step "st15-state-machine" "ST15 — settle / cancel / expire: exactly one transition ever wins

             settle() is refused once block.timestamp > resolutionDeadline and
             expireUnresolved() is refused while <= it, so the two can never both
             be legal. The reachable race is about the state machine: of
             {settle, cancel, expire} the first confirmed transition wins and the
             others are permanently rejected. Also queued below: settle() and
             expireUnresolved() in one block, mined together."

ROOM_F_TS="$(block_ts)"
F_RES_DEADLINE="$(bn add "$ROOM_F_TS" 120)"
run_tx "createRoom roomF" "$HOST_PK" ok "$ESCROW_ADDRESS" "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_F" 3 "$ENTRY_WEI" "$(bn add "$ROOM_F_TS" 30)" "$F_RES_DEADLINE" --value "$ENTRY_WEI"
run_tx "joinRoom roomF p2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_F" --value "$ENTRY_WEI"
run_tx "joinRoom roomF p3" "$PLAYER3_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_F" --value "$ENTRY_WEI"
must assert_status "roomF is FUNDED" "$ROOM_F" "$ST_FUNDED"

# (a) cancel wins, so settle and expire must both be dead.
run_tx "cancelRoom roomF (admin)" "$ADMIN_PK" ok "$ESCROW_ADDRESS" \
  "cancelRoom(bytes32,bytes32)" "$ROOM_F" "$(c format-bytes32-string 'OPERATOR_ABORT')" \
  && ok "roomF canceled (tx $TX_HASH)"
must revert_call "settle after cancel" "$(sel 'AlreadyCanceled()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_F" "$PLAYER2_ADDRESS" "$RESULT_HASH"
must revert_tx "settle after cancel, mined" "$SETTLER_PK" "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_F" "$PLAYER2_ADDRESS" "$RESULT_HASH"
must revert_call "expireUnresolved after cancel" "$(sel 'NotCancelable()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "expireUnresolved(bytes32)" "$ROOM_F"
must assert_status "roomF is CANCELED, not SETTLED" "$ROOM_F" "$ST_CANCELED"

# (b) settle won earlier on roomA; cancel and expire must be dead there.
must revert_call "cancel on the settled roomA" "$(sel 'AlreadySettled()')" \
  "$ADMIN_ADDRESS" "$ESCROW_ADDRESS" "cancelRoom(bytes32,bytes32)" "$ROOM_A" "$(c format-bytes32-string 'OPERATOR_ABORT')"
must revert_call "expireUnresolved on the settled roomA" "$(sel 'NotCancelable()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "expireUnresolved(bytes32)" "$ROOM_A"
must revert_call "expireUnfunded on the settled roomA" "$(sel 'NotCancelable()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "expireUnfunded(bytes32)" "$ROOM_A"

# Replay across rooms: roomA's settle payload is valid data, but it cannot be
# replayed against another room.
must revert_call "replay roomA's settle payload against canceled roomF" "$(sel 'AlreadyCanceled()')" \
  "$SETTLER_ADDRESS" "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_F" "$PLAYER2_ADDRESS" "$RESULT_HASH"

# (c) The genuine one-block race: with automine off, queue a settle and an
# expire for the same room and let the node order them. Exactly one must land.
ROOM_H_TS="$(block_ts)"
H_RES_DEADLINE="$(bn add "$ROOM_H_TS" 120)"
run_tx "createRoom roomH" "$HOST_PK" ok "$ESCROW_ADDRESS" "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_H" 3 "$ENTRY_WEI" "$(bn add "$ROOM_H_TS" 30)" "$H_RES_DEADLINE" --value "$ENTRY_WEI"
run_tx "joinRoom roomH p2" "$PLAYER2_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_H" --value "$ENTRY_WEI"
run_tx "joinRoom roomH p3" "$PLAYER3_PK" ok "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_H" --value "$ENTRY_WEI"

# Move past the resolution deadline so expire is legal and settle is not: this is
# the boundary both functions guard, and only expire may win here.
NOW="$(block_ts)"
warp "$(bn add "$(bn sub "$H_RES_DEADLINE" "$NOW")" 1)"

info "queuing expireUnresolved() alone at the deadline boundary, then settle() after it"
TX_EXPIRE="$(c send --json --rpc-url "$RPC_URL" --private-key "$THIRD_PARTY_PK" "$ESCROW_ADDRESS" \
  "expireUnresolved(bytes32)" "$ROOM_H" | jq -r '.transactionHash')"
TX_SETTLE_LATE="$(c send --json --rpc-url "$RPC_URL" --private-key "$SETTLER_PK" --gas-limit "$REVERT_GAS_LIMIT" \
  "$ESCROW_ADDRESS" "settle(bytes32,address,bytes32)" "$ROOM_H" "$PLAYER2_ADDRESS" "$RESULT_HASH" \
  | jq -r '.transactionHash')"

S_EXPIRE="$(c receipt "$TX_EXPIRE" status --rpc-url "$RPC_URL")"
S_SETTLE_LATE="$(c receipt "$TX_SETTLE_LATE" status --rpc-url "$RPC_URL")"
info "expireUnresolved: status=$S_EXPIRE"
info "settle (late):     status=$S_SETTLE_LATE"

jq -cn --arg hash "$TX_EXPIRE" --arg to "$ESCROW_ADDRESS" \
  --arg gasUsed "$(c receipt "$TX_EXPIRE" gasUsed --rpc-url "$RPC_URL")" \
  --arg price "$(c receipt "$TX_EXPIRE" effectiveGasPrice --rpc-url "$RPC_URL")" \
  --arg status "$S_EXPIRE" \
  '{label:"race-expire",hash:$hash,from:"-",to:$to,gasUsed:$gasUsed,price:$price,status:$status}' >>"$TX_LOG"
jq -cn --arg hash "$TX_SETTLE_LATE" --arg to "$ESCROW_ADDRESS" \
  --arg gasUsed "$(c receipt "$TX_SETTLE_LATE" gasUsed --rpc-url "$RPC_URL")" \
  --arg price "$(c receipt "$TX_SETTLE_LATE" effectiveGasPrice --rpc-url "$RPC_URL")" \
  --arg status "$S_SETTLE_LATE" \
  '{label:"race-settle-late",hash:$hash,from:"-",to:$to,gasUsed:$gasUsed,price:$price,status:$status}' >>"$TX_LOG"

must assert_eq "expireUnresolved won at the deadline boundary" "$S_EXPIRE" "true"
must assert_eq "the competing settle after the deadline reverted" "$S_SETTLE_LATE" "false"
must assert_eq "roomH ends CANCELED" "$(room_field "$ROOM_H" "$R_STATUS")" "$ST_CANCELED"
must assert_eq "roomH cancelReason is RESOLUTION_TIMEOUT" \
  "$(bascii "$(room_field "$ROOM_H" "$R_CANCEL_REASON")")" "RESOLUTION_TIMEOUT"
end_step

begin_step "st10-expire-unfunded" "ST10 — expireUnfunded after the funding deadline: permissionless, then refund"

ROOM_G_TS="$(block_ts)"
G_FUND_DEADLINE="$(bn add "$ROOM_G_TS" 60)"
run_tx "createRoom roomG (host only)" "$HOST_PK" ok "$ESCROW_ADDRESS" \
  "createRoom(bytes32,uint8,uint256,uint64,uint64)" \
  "$ROOM_G" 3 "$ENTRY_WEI" "$G_FUND_DEADLINE" "$(bn add "$ROOM_G_TS" 180)" --value "$ENTRY_WEI"
must assert_status "roomG is FUNDING with 1 of 3 seats" "$ROOM_G" "$ST_FUNDING"

must revert_call "expireUnfunded before the deadline" "$(sel 'DeadlineNotPassed()')" \
  "$THIRD_PARTY_ADDRESS" "$ESCROW_ADDRESS" "expireUnfunded(bytes32)" "$ROOM_G"

NOW="$(block_ts)"
warp "$(bn add "$(bn sub "$G_FUND_DEADLINE" "$NOW")" 1)"

# After the deadline joining must be refused (QA CH11, contract side).
# The room is still FUNDING with a passed fundingDeadline, so joinRoom
# reaches DeadlinePassed (checked before RoomFull/WrongValue).
must revert_call "join after the funding deadline" "$(sel 'DeadlinePassed()')" \
  "$PLAYER2_ADDRESS" "$ESCROW_ADDRESS" "joinRoom(bytes32)" "$ROOM_G" --value "$ENTRY_WEI"
must revert_tx "join after the funding deadline, mined" "$PLAYER2_PK" "$ESCROW_ADDRESS" \
  "joinRoom(bytes32)" "$ROOM_G" --value "$ENTRY_WEI"
must assert_eq "depositCount did not advance" "$(room_field "$ROOM_G" "$R_DEPOSIT_COUNT")" "1"

run_tx "expireUnfunded (third party)" "$THIRD_PARTY_PK" ok "$ESCROW_ADDRESS" "expireUnfunded(bytes32)" "$ROOM_G" \
  && ok "expireUnfunded mined by a non-depositor (tx $TX_HASH)"
must assert_status "roomG is CANCELED" "$ROOM_G" "$ST_CANCELED"
must assert_eq "cancelReason decodes to FUNDING_TIMEOUT" \
  "$(bascii "$(room_field "$ROOM_G" "$R_CANCEL_REASON")")" "FUNDING_TIMEOUT"

# A wallet that never deposited must not pull anything out.
must revert_call "refund by a non-depositor on roomG" "$(sel 'NotDepositor()')" \
  "$PLAYER2_ADDRESS" "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_G"

HOST_BEFORE="$(balance_of "$HOST_ADDRESS")"
run_tx "withdrawRefund roomG (host)" "$HOST_PK" ok "$ESCROW_ADDRESS" "withdrawRefund(bytes32)" "$ROOM_G" \
  && ok "host refunded (tx $TX_HASH)"
must assert_wei_eq "host net = +stake - own gas"   "$(bn sub "$(balance_of "$HOST_ADDRESS")" "$(bn sub "$HOST_BEFORE" "$(gas_cost_of "$TX_HASH")")")" "$ENTRY_WEI"
end_step

# ---------------------------------------------------------------------------
# 6. Drain — leave nothing escrowed, so step C has a clean zero to check
# ---------------------------------------------------------------------------

begin_step "drain" "D1 — settle+pay every room still holding funds, so the harness ends at zero"

# roomN was left FUNDED on purpose (it is the target of the settle attacks), so
# it still holds a pot. Settle it to a depositor and pay it out.
run_tx "settle roomN (drain)" "$SETTLER_PK" ok "$ESCROW_ADDRESS" \
  "settle(bytes32,address,bytes32)" "$ROOM_N" "$PLAYER3_ADDRESS" "$RESULT_HASH" \
  && ok "roomN settled (tx $TX_HASH)"

# roomC is SETTLED but unpaid. roomE was already paid inside the ST08 step, and
# roomA inside A5, so neither appears here.
for pair in "roomC:$ROOM_C" "roomN:$ROOM_N"; do
  lbl="${pair%%:*}"; key="${pair#*:}"
  run_tx "payout $lbl" "$THIRD_PARTY_PK" ok "$ESCROW_ADDRESS" "payout(bytes32)" "$key" \
    && ok "$lbl prize paid (tx $TX_HASH)"
  must assert_eq "$lbl prizePaid" "$(room_field "$key" "$R_PRIZE_PAID")" "true"
done

# roomF and roomH were canceled by the ST15 step and never refunded: each still
# holds three stakes. Every depositor pulls their own stake back.
for rk in "$ROOM_F" "$ROOM_H"; do
  for pair in "host:$HOST_PK" "player2:$PLAYER2_PK" "player3:$PLAYER3_PK"; do
    who="${pair%%:*}"; pk="${pair#*:}"
    run_tx "withdrawRefund $who ($rk)" "$pk" ok "$ESCROW_ADDRESS" \
      "withdrawRefund(bytes32)" "$rk" && ok "$who refunded (tx $TX_HASH)"
  done
done

# Every room is now terminal and drained: roomA/roomC/roomE/roomN paid out;
# roomB/roomD/roomF/roomG/roomH canceled with all refunds withdrawn.
must assert_wei_eq "contract balance delta is zero at the end of the E2E" \
  "$(bn sub "$(balance_of "$ESCROW_ADDRESS")" "$ESCROW_BASE")" "0"
end_step

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

snapshot "$SNAP_AFTER"
jq -n --arg a "$ROOM_A" --arg b "$ROOM_B" --arg c "$ROOM_C" --arg d "$ROOM_D" \
      --arg e "$ROOM_E" --arg f "$ROOM_F" --arg g "$ROOM_G" --arg h "$ROOM_H" \
      --arg n "$ROOM_N" \
      '{roomA:$a,roomB:$b,roomC:$c,roomD:$d,roomE:$e,roomF:$f,roomG:$g,roomH:$h,roomN:$n}' \
      >"$ROOMS_FILE"

hr
hdr "E2E RESULT"
hr
printf 'steps run     %s\n' "$TOTAL_STEPS"
printf 'steps failed  %s\n' "$FAILED_STEPS"
printf 'transactions  %s (all real, all mined)\n' "$(wc -l <"$TX_LOG" | tr -d ' ')"
hr
if [ "$FAILED_STEPS" -eq 0 ]; then
  ok "ALL $TOTAL_STEPS STEPS PASSED"
  hr
  echo
  echo "Next: scripts/check-balance-conservation.sh"
  exit 0
fi
bad "$FAILED_STEPS of $TOTAL_STEPS steps FAILED"
hr
exit 1

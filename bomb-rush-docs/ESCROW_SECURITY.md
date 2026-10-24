# ESCROW_SECURITY — v0.5 Threat Model & Stop-Ship Tests

## Trust boundaries
1. **Wallet/browser → backend:** untrusted. Names, tx hashes, room IDs, addresses, pass intents, and claimed timestamps are untrusted.
2. **RPC/indexer → backend:** unreliable/time-varying. A transient `eth_getLogs` result, mempool tx, pending receipt, and finalized transaction are different observations.
3. **Backend → contract:** trusted *authorized settler*; this role can lie about winner if compromised. Smart contract enforces winner among depositors, exact pool/no-double-pay, but NOT game fairness.
4. **Contract → external winner wallet:** value transfer may reenter or revert. Guard call, apply effects before interactions and revert atomically on transfer failure.
5. **Operator/deployer/admin:** privileged; disclose in pitch. Runtime signer and deployment key separated.

## Minimum threat matrix
| Threat | Mitigation / verification | Release gate |
|---|---|---|
| Repeated `joinRoom` wallet | `deposited[roomId][msg.sender]` guard | two deposits same wallet fail |
| Incorrect amount; `msg.value=0` | exact wei equality; entryWei>0 | negative/fraction UI invalid; wrong wei revert |
| Different room/chain spoof | Compare chain 10143, contract address, log topic, roomKey, sender, value, success receipt | forged txHash never marks FUNDED |
| Frontend changes winner | Server-only authoritative simulator + onlySettler contract | client cannot submit payout winner |
| Unauthorized settlement | Role control and eligible depositor check | non-settler reverts, non-depositor winner reverts |
| Double settlement / double payout | Mutual exclusive status + prizePaid | second call reverts, pot conserved |
| Refund + payout race | SETTLED and CANCELED mutually exclusive | never both on same room |
| Server restart while funds held | On-chain deadlines permissionlessly cancel; wallet-based withdraw independent of backend | funds recover without server |
| Reentrancy on native transfers | nonReentrant + effects before call | malicious contract test |
| Wallet rejects native MON transfer | revert atomically; claim not consumed | retry possible |
| Early/late timestamps | contract timestamp seconds and deadline guards | boundary tests at = and > deadline |
| RPC outage/fork/reorg | verify receipt & chain state; delay final badge until appropriate finalized evidence | never display false paid |
| Operator payout to itself | winner must be existing funded depositor | unauthorized recipient blocked; oracle still trusted |
| Duplicate wallet seat from tabs | session proof and on-chain wallet uniqueness | one funded seat per wallet |
| Wallet deep-link resumes | recompute chain state and current session | no duplicate deposit call |
| Sybil across wallets | Not solved in P0 | do NOT claim prevention |
| Room code brute force | random code, rate limit API, no fake privacy guarantee | codes not used as financial auth |

## Concurrency constraints
`settle`, `cancelRoom` and `expireUnresolved` can race. A single on-chain room status is the arbiter; first valid state transition wins. Contract MUST NOT allow refund once settled or settle once canceled. Backend MUST treat stale pending status as tentative and reread after confirmed receipt.

## Balance conservation
For each funded room, contractual allocation must always satisfy:
- FUNDING/FUNDED: `locked = entryWei * depositCount`.
- CANCELED: `totalRefunded + refundableRemaining == entryWei * depositCount`.
- SETTLED: `prizePaidValue + claimablePrize == entryWei * depositCount`.
- No room pays out more than originally received; no operator fee.
If direct unsolicited native token transfers alter contract balance, **do not silently include them in the room pool**.

## Mandatory Foundry/Hardhat test cases
`create_valid_host_funded`, `create_duplicate_id_reverts`, `seats_outside_3_4_reverts`, `wrong_chain_config_guard`, `bad_entry_reverts`, `funding_window_reverts`, `duplicate_wallet_reverts`, `join_exact_amount`, `funding_to_funded_exact_seats`, `settle_only_settler`, `settle_non_depositor_reverts`, `settle_duplicate_reverts`, `payout_before_settle_reverts`, `payout_once`, `payout_to_recorded_winner_only`, `refund_funding_expired`, `refund_funded_unresolved_expired`, `refund_only_depositor`, `double_refund_reverts`, `settled_cannot_refund`, `canceled_cannot_settle`, `reentrancy_receiver`, `rejecting_receiver_does_not_consume_claim`, `fuzz_balance_conservation`, `replay_across_room_ids`, `rpc_missing_receipt_does_not_mark_confirmed`.

## Realistic failure behaviors
- **Unfunded timeout:** anyone expires → depositors withdraw individually.
- **Funded game canceled:** operator cancels or anyone expires at resolution deadline → same refunds.
- **Wallet rejects signature:** room remains unjoined, no FUNDED badge.
- **Payout tx fails:** winner remains claimable on chain; retry. Do not mark PAID.
- **Game finishes but settler offline:** display awaiting settlement; if deadline expires and no settlement, allow expired cancellation + refunds, NOT fabricated win.
- **Browser/backend gone:** contract state/recovery accessible directly via wallet or chain explorer. Include UI-independent function guidance in runbook.

## Governance/legal controls
TESTNET ONLY • NO REAL VALUE. No implementation claim of legality; ask event organizer whether even testnet pool-style gameplay is acceptable. Do not enable mainnet, value conversion, real fees, or economic rewards. Security review by someone other than implementer is a prerequisite to public testnet deposit flow.

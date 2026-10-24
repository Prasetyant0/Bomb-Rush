# AUDIT_CHECKLIST — v0.5 Release Gate

This is a checklist to **execute**, not a claim that checks have passed. An automated document consistency scan may mark text checks, but **cannot** replace contract security tests, on-chain receipts, or real-device QA.

## 1. Documentation and protocol
- [ ] All active files declare `v0.5` and the README identifies testnet pool mode.
- [ ] `API_CONTRACT` constants match `packages/shared` byte-for-byte.
- [ ] Solidity ABI in code matches the canonical 5-argument `createRoom` and remaining methods/events.
- [ ] `RoomPublicState` uses `entryWei`, `potWei` as decimal strings and 10143 chain ID, no active `entryCredits`.
- [ ] `GameStatus` and `EscrowStatus` are independent and all UI views distinguish settlement from payout.
- [ ] Crossplay gameplay values unchanged: 3–4, 10s bomb cycle, 20/30s, 15s lobby, radius7, pass 1.8u, five stamina bars.

## 2. Contract review (MANDATORY)
- [ ] Unique room IDs, exact msg.value, 3–4 seats and unique wallet membership.
- [ ] No settle without fully funded pot and eligible depositor winner.
- [ ] Role-controlled settler and non-mainnet/testnet-specific deployment config.
- [ ] Settlement and refunds are mutually exclusive; no double payout/withdraw.
- [ ] Native transfer with reentrancy protection and checks-effects-interactions.
- [ ] Reverted transfer leaves prize/refund available to retry.
- [ ] Funding deadline allows `expireUnfunded`; resolution deadline allows `expireUnresolved`, callable by anyone.
- [ ] Server death cannot permanently lock funds: wallet + gas + on-chain expiry works.
- [ ] No unauthorized treasury extraction / accidental fee mechanism.
- [ ] All critical local-EVM and testnet tests pass with logs saved.
- [ ] One developer other than contract author reviews every withdrawal/settlement path.

## 3. Server and auth
- [ ] Wallet challenge validates domain, chain ID, nonce, expiry, and wallet signature.
- [ ] Receipt parsing validates success, chain, contract, event, roomKey, sender, exact wei.
- [ ] Duplicate receipts/events idempotent; wrong tx hash / wrong account rejected.
- [ ] No client-authoritative result, pot amount, holder, position, stamina or winner.
- [ ] Reconnect, camera orientation, 5s disconnect grace and server time behavior tested.
- [ ] Backend restart during FUNDED status triggers no fictitious winner; public chain recovery works.

## 4. UI / accessibility / device
- [ ] Every funded view says Monad Testnet / No Real Value; correct actual contract address.
- [ ] Wrong-chain and rejected-wallet messages actionable; no lost deposit due to reload.
- [ ] Funded, claimable and paid badges only follow independently verified state.
- [ ] Desktop / Android / iOS complete live 3-player round; 4-player round on additional window/device.
- [ ] Mobile landscape joystick+RUN+PASS multi-touch works.
- [ ] Winner result contains actual on-chain hashes; canceled state contains refund route.
- [ ] UX does not look like real-money casino or imply financial returns.

## 5. Performance and presentation
- [ ] Measure actual wallet→receipt latency and record sample count + failures.
- [ ] Never claim network 10K TPS as app-measured throughput.
- [ ] Never claim trustless fairness / audit completion.
- [ ] Confirm organizer permits this testnet pool demo.
- [ ] Backup recording is labeled if used; no fake live settlement.
- [ ] Document all known blocking issues and show partial instead of misleading full success.

## Release status (fill after testing)
- Solidity tests: NOT RUN IN THIS DOCUMENT PACK
- Monad Testnet deployed address: NOT PROVIDED
- Live deposit + payout receipts: NOT PROVIDED
- Refund/recovery proof: NOT PROVIDED
- Mobile crossplay acceptance: NOT RUN IN THIS DOCUMENT PACK
- Legal/event-rule approval: NOT VERIFIED

**Release status for this deliverable: DOCUMENTATION READY FOR IMPLEMENTATION REVIEW — NOT GAME/ESCROW RELEASE APPROVED.**

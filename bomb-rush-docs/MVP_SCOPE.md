# MVP_SCOPE — v0.5 Scope and Release Gates

## P0 — must ship for the *funded testnet demo* claim
1. Public HTTPS/WSS build works on desktop, Android Chrome, iOS Safari; 3–4 human players can enter same room.
2. Create room UI validates exact test MON amount and fixed 3/4 capacity; wallet network switches/verifies chain 10143; host sends `createRoom` deposit.
3. Join by code fetches chain room details; shows immutable amount, funded count, deadline, contract address, risk/testnet label; player signs exact `joinRoom` value.
4. **Only a matching confirmed contract event/receipt sets `funded=true`**, once per distinct wallet. Host seat counts as funded only after confirmed creation.
5. Lobby READY opens only for funded seats; `FUNDED` on chain AND exactly selected seat count AND all ready → server-anchored 15 s countdown. No late joins.
6. 3D circular radius-7 unobstructed arena, third-person camera; desktop and mobile landscape controls; smooth low-poly assets and clear carrier cue.
7. Server-authoritative 20 Hz movement, clamp, stamina, pass, bomb, elimination and one winner. Bomb cycles 10 s, pass never resets; 3 players=20 s, 4=30 s nominal gameplay.
8. Server records result, uses settlement signer for `settle(roomId, winner, resultHash)` only once; result screen distinguishes RESULT DECLARED, SETTLEMENT PENDING/CONFIRMED/FAILED.
9. Winner's full pool becomes **claimable** on successful settlement. `payout(roomId)` can be invoked by winner or anyone, funds go only to winner; UI shows transfer confirmation and transaction explorer proof.
10. `cancelRoom`, permissionless deadline expiry, `withdrawRefund` for each depositor; UI can recover funds after server restart using contract read methods and wallet address.
11. Contract tests for: wrong deposit, double deposit, invalid winner, unauthorized settlement, duplicate settle/payout, cancellation/refunds, forced timeout, recipient transfer failure, balance conservation and chain mismatch.
12. Demo walkthrough with **actual confirmed tx hashes**; measured deposit + payout latency, no false TPS claims; honest fallback shown if economic path incomplete.

## P1 — optional and not on the critical path
Guest-only practice (no pool), spectator camera, audio/VFX, public room discovery, a live multi-room activity dashboard using **real** aggregated events, improved accessibility, match receipts export, practice bot transparently labeled.

## P2 — exclude from the hackathon MVP
Mainnet, real value/economic wagering, withdrawal to fiat, fees, decentralised winner verification, player reputation, NFTs, anti-sybil, tournaments, deployed cloud DB, trustless cryptographic replay proofs, gas sponsorship, advanced benchmarking.

## Atomic release rules / no unsafe partial modes
- If escrow contract tests fail, **DISABLE FUNDED ROOM CREATION**. UI-only simulation may run with banner "NO ON-CHAIN DEPOSITS".
- If payout works but timeout refunds fail, **DO NOT ENABLE DEPOSITS**. Fund safety takes precedence over stage demo.
- Never display wallet confirmation as settlement finality; require verified receipt + contract state.
- If server crashes, deadline-based contract refund remains available outside server (verified explorer/wallet transaction route); UI should reconstruct via contract reads.
- Never invent transaction hashes, wallet signatures, juri interactions, performance measurements, or confirmed winners.

## Cut order when sprint runs late
Cosmetic polish → 3D asset richness → spectating → rooms browser → scoreboard → demo dashboard → profile/guest practice. Never cut essential crossplay, contract safety, deposit reconciliation, refund, payout correctness, or honest messaging. If one essential component fails, classify build as partial rather than pretending full completion.

## Acceptance signoff
- Dev A: laptop + Android + iOS gameplay smoke pass.
- Dev B: 3/4 player authoritative match, no fabricated winner, restart/reconnect handling.
- Dev C: all escrow invariants pass local EVM + Monad Testnet canary funding/payout/refund receipts.
- Lead: event permits testnet pool demo; risks and claims approved; `AUDIT_CHECKLIST.md` complete.

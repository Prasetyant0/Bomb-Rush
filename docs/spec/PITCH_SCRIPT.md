# PITCH_SCRIPT — Three-Minute Pitch v0.5

**Before stage:** confirm event permits demo mechanic; do not run any value-based product. Adjust this script to reality: if funded flow unfinished, remove success claims and state exactly what works. No unmeasured statistics.

## 0:00–0:20 Hook
"One bomb. Three players. Twenty seconds. Only one survives." [Pause.] "BOMB RUSH is a cross-device survival arcade game, made for friends to play together in under a minute. And our pool transactions are visible on Monad Testnet."

## 0:20–0:45 Why it matters
"Many web3 demos emphasize wallet setup before demonstrating a useful interaction. We start with understandable gameplay and use the chain only where it adds transparency: contributions into a shared testnet pool and observable settlement."

## 0:45–1:15 How it works
"A host creates a room for three or four players and sets a fixed test MON contribution. Each player funds exactly one seat in a public testnet contract. When the selected seats are funded and ready, the game starts. You run, sprint and pass a timed bomb. The timer never resets on a pass. The final survivor is our winner."

"We keep the arcade gameplay off-chain so controls remain responsive. Our backend determines the winner. The contract checks that this address really funded this room before allocating the testnet pool. The server then automatically triggers a separate verifiable on-chain transfer to the winner; permissionless retry exists if that trigger fails."

## 1:15–2:20 Live demo
- Create and fund one room from wallet; show verified tx.
- Join with 2 wallets; show actual contract funding total.
- Ready → countdown → game (20s nominal) → only one winner.
- Show MatchSettled receipt and PrizePaid receipt (or truthful pending/claimable state if delayed).
- Keep narration minimalist; wallet and network waits are unpredictable.

## 2:20–2:45 Why Monad
"Monad is EVM-compatible and designed for high throughput and fast block production. This demo tests how those characteristics feel in our real wallet-to-receipt path. We record actual confirmation times rather than presenting the protocol's published TPS as our benchmark."

## 2:45–3:00 Close
"BOMB RUSH makes on-chain state tangible to an audience. You can see the room fund, watch the match, and inspect the result allocation and payout on a real testnet explorer. No monetary value, no mainnet stakes — just a playable transparent technical demonstration."

## Hard jury questions / defensible answers
**Q: Why blockchain?** A: "The chain holds the testnet pool and exposes funding, settlement, payout and refunds independently of our UI. It adds verifiable financial state; moment-to-moment gameplay doesn't need it."  
**Q: Is it provably fair?** A: "No. Results are server-authoritative and an authorized settler submits them; the contract checks eligible depositor and prevents double payout, but does not verify gameplay. Trustless fairness is future research."  
**Q: Why Monad 10K TPS?** A: "Throughput is network capacity, not our measured game usage. Our benefit today is EVM compatibility and potentially fast settlement; we show measured actual latency."  
**Q: What if your server dies with deposits?** A: "The smart contract owns testnet deposits independently. After bounded deadlines a wallet can expire the room and withdraw its own refund without our server."  
**Q: Is this gambling?** A: "This is a no-real-value testnet demonstration only, subject to organizer rules. We are not claiming a production, legal, real-stakes product."  
**Q: Is smart contract audited?** A: "No independent professional audit in this MVP. It is intended to undergo unit/fuzz/reentrancy checks and peer review before demo deposits; production launch would require a separate review."

## Evidence to prepare
Contract address, deployment receipt, 3 deposits, match result hash, MatchSettled tx, PrizePaid tx, separate tested refund tx; measured latency table with n, failures and timestamps; cross-device live and backup recorded match. Never invent missing receipts.

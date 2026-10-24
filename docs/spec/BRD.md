# BRD — Business / Hackathon Requirements v0.5

## Problem and opportunity
Short-form party games should be instantly understandable, cross-platform and demonstrable. Web3 integration in casual games is often a decorative token/badge without a concrete user-visible trust benefit. BOMB RUSH explores a **fully transparent testnet-only pool** whose contributions, match result commitment, allocation and actual payout/refund can be inspected publicly. No real-value transfers or promise of legality.

## Core value proposition
1. **Play-first:** one short match in 20–30 seconds of gameplay, 3–4 friends on browsers.
2. **Transparent demonstration:** exact test MON deposits locked in a public contract, not arbitrary server credits.
3. **Verifiable financial state:** observers can inspect room funding, committed winner allocation, prize transfer and refunds on Monad Testnet.
4. **Fail-safe design:** dead server cannot keep a testnet pool locked forever because expired room refunds can proceed on chain.

## Stakeholders / success criteria
| Stakeholder | Job to be done | Evidence |
|---|---|---|
| Player | Join and understand what happens | 1-minute onboarding, clear exact deposit + deadline |
| Host | Create funded room and share | Contract room confirmed and shareable code |
| Judge | Observe actual chain integration | Deposit/settlement/payout/refund hashes and verified explorer |
| Developer | Ship reliable crossplay | 3 browsers + iOS/Android full match; error paths |
| Organizer | Accept demo within event rules | Testnet only, no monetization, explicit risk disclosure |

## Non-negotiable risks
- **Regulatory:** winner-takes-all mechanism resembles wagering even with worthless test tokens. Do not infer it is approved or legal; verify hackathon eligibility with organizers. No real-value roadmap claim in pitch.
- **Security:** trusted backend result oracle and settlement signer; restricted role reduces theft vectors but does not establish fairness.
- **Operational:** browser wallets, RPC lag, refunds and deploy are harder than result-only logging; complexity may make six-hour target unrealistic.
- **Reputation:** falsely claiming real payout, 10K TPS measured, trustless game, or audit readiness harms credibility.

## Impact / product evidence
Use observed metrics: three devices sharing a game room, time from wallet confirmation request→receipt, fund matching and exact payout, number of successful runs, cancel/refund demonstration. Report failures and fallbacks honestly. Monetization and production business plan intentionally **out of scope**.

## Out of scope
Real money/value, paid competition, fee extraction, mainnet, investment product, tokenomics, contract revenue, dividends, trading/financial services. This demo does not establish a viable regulated commercial wagering business.

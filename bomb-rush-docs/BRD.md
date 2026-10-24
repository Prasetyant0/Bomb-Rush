# BRD — Business Requirements Document

## 1. Executive summary
**BOMB RUSH 3D** is a cross-platform browser-based (desktop + mobile), round-based party survival game. Players enter a short multiplayer room, avoid holding the bomb when its timer reaches zero, and survive to become the last player standing. Monad enables portable wallet identity and an observable testnet demonstration of match entry/record/reward mechanics. The core differentiator is a **spectator-friendly, 60–90 second 3D competitive social experience**, not a novel gambling mechanism.

## 2. Problem and opportunity
- Most on-chain demos prioritize wallet transactions over enjoyable gameplay; players need immediate gratification from actual play.
- Web3 hackathon pitches benefit from memorable short live matches, visible network usage, and explainable outcomes.
- A low-poly browser game can be opened on ordinary laptops and modern mobile browsers without game installations.

## 3. Goals / non-goals
**Goals (hackathon):**
1. Three distinct devices or browser sessions (including at least one mobile) can join, and 3 participants enter a real match (up to one labeled demo bot).
2. User understands controls in ≤ 10 seconds on keyboard/mouse and touchscreen without an instructor.
3. A match deterministically ends in one winner, with no client-authorized outcomes.
4. An on-chain Monad Testnet record or mock prize-pool settlement is demonstrable and independently inspectable.
5. Judges can play one full match live, then view result and transaction link.

**Non-goals (MVP):** native mobile apps (mobile *web* is P0), cosmetics marketplace, ranked matchmaking, wallet custody service, mainnet deposits, cash prizes, real-money stakes, external wagering, production anti-cheat certification.

## 4. Stakeholders
- Player: joins, competes, inspects testnet records.
- Room creator: chooses rules and test-entry amount, sends invite.
- Platform operator: runs server; can enable a clearly disclosed *test-only* bot.
- Judges/audience: fast onboarding, visible outcome, explorer proof.
- Compliance/security reviewer: legal gates, fair play, custody boundaries.

## 5. Business requirements
| ID | Requirement | Priority | Verification |
|---|---|---|---|
| BR-01 | Playable multiplayer round with ≤ 90 s typical session | Must | 3-human live test |
| BR-02 | Creator selects fixed per-room demo entry via preset/custom | Must | Amount shown consistently |
| BR-03 | Lobby starts only with 3–4 ready funded/confirmed participants | Must | State-machine test |
| BR-04 | At most one disclosed operator demo bot; at least two humans | Should | Bot constraint test |
| BR-05 | Result visible with winner, player list, test pool, transaction | Must | End-to-end walkthrough |
| BR-06 | Canceled room returns demo test assets where applicable | Should | Expiry/cancel test |
| BR-07 | Mainnet/real-value wager functionality disabled | Must | Environment and contract config gate |
| BR-08 | Operators cannot secretly choose winner/bomb timer | Must | Server audit logs, protocol tests |
| BR-09 | Full gameplay on Android/iOS mobile web plus desktop | Must | One Android, one iOS, one desktop mixed-device match |
| BR-10 | Orbit third-person camera, per-platform input with shared game logic | Must | Mouse and multitouch gesture tests |
| BR-11 | Sprint has 5-bar server-validated stamina with deliberate recharge delay | Must | Deterministic stamina test vectors |

## 6. Success metrics (goals, not forecast)
- **Completion rate:** ≥ 90% of demo matches end with an unambiguous winner.
- **Time to play:** ≤ 2 minutes from landing to first active round in P0 virtual-point mode; wallet connection may complete before or after playing.
- **Demo reliability:** ≥ 3 consecutive successful live rounds including on-chain proof; 0 double settlements.
- **Performance:** target 60 FPS desktop and ≥30 FPS supported mobile on the simple arena; measure on actual devices. Mobile play is mandatory, not optional.

## 7. Risk register
| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Gambling law and public perception | High for real-value mode | Critical | Testnet-only demonstration; legal review before any value-bearing launch |
| Operator bot conflict of interest | High | Critical | Clear labels, user opt-in, no future cash competition, documented algorithm, independent verification needed |
| Host/server cheating | Medium | High | Server-side rules, audit trail, protocol transparency; avoid claiming trustlessness |
| Multiplayer drift/disconnection | Medium | High | Server authority, reconnect deadline, timeout, idempotent actions |
| On-chain transaction latency | Medium | High | Separate lobby prep, transaction state UX, wait for confirmation |
| Low match attendance | High | Medium | Invite QR and demo bot in test-only matches |

## 8. Key business decision
**Approved design direction:** free-play and/or test MON simulation; no real-money stake feature in MVP. If future prize competitions are contemplated, require formal legal and fairness assessment and independent audit. Do not interpret this document as a legal opinion.


## 9. Cross-platform value proposition (v0.3)
- Mixed-device room is the core differentiator: a judge can scan QR and compete with players on laptop, Android and iPhone in a single synchronized match.
- Mobile-first *gameplay* and responsive portrait menus are P0; camera and stamina share the exact server rules across platforms.
- A spectator-friendly third-person framing, visible bomb indicator and short matches support a credible 60–90 second pitch demo.
- Success criteria: 3 device families complete one match, joystick + swipe + PASS work simultaneously, UI does not obscure core action, no exploitable sprint advantage for PC/mobile.

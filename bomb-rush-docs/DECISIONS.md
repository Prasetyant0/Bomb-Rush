# DECISIONS.md — Frozen Baseline and Remaining Questions

**Version:** v0.3 · 23 October 2026

## Locked v0.3 decisions

| Decision | Status | Canonical value |
|---|---|---|
| Platform | LOCKED | Desktop browser + Android Chrome + iOS Safari mobile web are P0; native app excluded |
| Mobile UX | LOCKED | Portrait all menus; landscape arena; touch overlays and rotate prompt |
| Camera | LOCKED | Third-person orbit-follow, desktop mouse drag, mobile right swipe |
| Movement | LOCKED | WASD / left floating joystick, camera-relative mapped to normalized world vector |
| Sprint | LOCKED | Shift hold PC; RUN toggle mobile; 5.0 bars; 1 bar/s drain; wait 1.5s then 1 bar/s regen |
| Speed | PROVISIONAL | Walk 4.5 u/s; sprint 7 u/s; balance in crossplay tests |
| Bomber speed buff | NOT APPROVED | No bonus by default; consider after testing if chaser too weak |
| Passing | LOCKED | E/PASS; server-nearest eligible ≤1.8 u; 0.7s pass cooldown, 1s anti-return |
| Arena | LOCKED | Flat compact one-level arena; shrink effect only P1 |
| Lobby | LOCKED | 3–4 seats; min 2 humans if visible demo bot; 15s countdown, 10min expiry |
| Bot | LOCKED | Max 1 opt-in **TEST ONLY** operator demo bot, fully disclosed, same server rules |
| Room demo pool | LOCKED P0 | Preset/custom **virtual test-MON-denominated points**, no real transfer; label everywhere |
| Web3 | LOCKED P0 | Monad Testnet result registry and explorer proof; wallet optional for practice |
| Testnet deposit escrow | P2 | Only if verified deposit/refund path and audit-like regression tests can be completed |
| Real MON stakes | OUT | No implementation/deployment; legal gambling and operator conflicts unresolved |
| Backend | LOCKED | Node.js TypeScript + Fastify + Socket.IO, 20Hz authoritative room sim |
| Persistence | LOCKED | PostgreSQL + Drizzle, single in-memory active room server for demo |
| Team | LOCKED | Three developers; shared types/event schemas merged before branch work |

## P0 release gates
- [ ] One laptop + Android + iPhone can load same public game URL and join one room.
- [ ] Two-thumb joystick and camera rotation work at the same time; RUN and PASS are usable.
- [ ] Input and stamina validation server-side; no client winning claims.
- [ ] Three participants can start, pass bomb, eliminate, and select unique winner.
- [ ] Short-lived reconnect retains same seat and does not restart match.
- [ ] Monad Testnet match result confirms once with valid explorer link.
- [ ] Venue fallback plan tested (hotspot, QR, manual room code, local practice recording).
- [ ] UI never claims mainnet prizes or real token transfers.

## P1 / P2
- P1: disclosed test bot, last-three-seconds panic VFX, spectator camera polish, shrinking arena, sound, graphics auto-detection.
- P2: actual testnet escrow with per-participant deposits, matching amount and permissionless refunds, achievement mint, cosmetics, tournaments.

## Remaining explicit design questions
1. Does the room auto-start at exactly 3 ready, or does host press `START`? **Default:** auto after 15s quorum countdown.
2. When 4th player attempts to join during 15s countdown? **Default:** queue/reject until next room; lock admissions at countdown start.
3. On mobile RUN toggle, should tap-toggle persist while screen is focused? **Default:** yes, but force off at zero stamina, joystick release and focus loss.
4. How to avoid spawn unfairness? **Default:** server distributes four spawn positions evenly around stage, random seed logged.
5. What if only 2 human demo devices available? **Default:** test bot opt-in; not a substitute for 3-device crossplay QA.

## Team execution reference
See `AGENT_HANDOFF.md` for roles, merge gates, six-hour clock, and anti-conflict agent prompts.

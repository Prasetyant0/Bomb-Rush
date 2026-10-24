# BOMB RUSH 3D — Developer Documentation Pack

**Version:** `0.3` (cross-platform gameplay baseline)  
**Updated:** 23 October 2026  
**Status:** design specification, not an implemented or audited game  
**Platforms:** desktop Chrome/Edge/Firefox and mobile Android Chrome / iOS Safari browser  
**Network:** Monad **Testnet** (`chainId: 10143`), test MON/virtual points only — no monetary value.

> **Single source of truth:** This README and `DECISIONS.md` fix v0.3 defaults. `GAMEPLAY_CONTROLS.md` fixes camera/input/stamina rules. `API_CONTRACT.md` fixes the shared network contract. If another document differs, update it before coding; do not silently follow the older rule.

## Scope and compliance

The original founder concept includes a creator-selected MON entry amount, pooled player deposits, and a possible operator-funded competing bot. The hackathon specification demonstrates this **only with virtual pool points (P0)**; optional **test MON escrow (P2, not baseline)** requires complete refund/security tests. There is **no real-value stake, real-money payout, or mainnet deployment**. A player-funded real-asset winner-takes-all product may be treated as gambling under Indonesian law; it is outside this pack's implementation scope pending specialist legal review.

A maximum of one **explicitly disclosed test-only demo bot** can fill a room, provided at least two humans participate. Operator-controlled competing bots create a conflict of interest and must never be concealed.

## Canonical product defaults

| Dimension | v0.3 rule |
|---|---|
| Match | Last-person-standing 3D hot potato, 3–4 seats, 2 humans + 1 visible bot allowed |
| Session | 60–90 second gameplay target; 15 second server-authoritative lobby countdown |
| Camera | **Third-person orbit follow**, drag mouse / swipe right-side touch; angle/zoom clamped |
| Desktop | **WASD** to move, **Shift (hold)** sprint, **E** pass bomb, mouse drag to orbit, Tab leaderboard |
| Mobile | **Landscape gameplay**, **left floating joystick**, **right swipe** orbit, **RUN toggle**, **PASS tap**; simultaneous 2-touch operation |
| Sprint | **5 energy bars** (continuous capacity 5.0), spend **1 bar/s**, **1.5 s delay** after stopping, regenerate **1 bar/s** while not sprinting |
| Speeds | Walk 4.5 world units/s; sprint 7.0 units/s; tune only after playtest |
| Bomb | 10 s countdown per explosion, unchanged by transfer; closest eligible target within 1.8 world units; 0.7 s pass cooldown; 1 s anti-return to former holder |
| Balance | Identical rules and server enforcement on PC and mobile; no untested carrier-speed bonus |
| Arena | One compact low-poly arena; clear warnings at last 3 seconds; shrinking arena is P1, not P0 |
| Demo entry | Host selects fixed preset `0.1/0.5/1/2` or custom `0.01–10` **virtual test-MON-denominated points**; never depict an actual blockchain deposit unless a tx exists |
| Chain P0 | Wallet optional to practice; server records final match hash/winner to Monad Testnet, explorer link after confirmation |
| Server | Node.js + TypeScript + Fastify + Socket.IO; authoritative 20 Hz loop; PostgreSQL + Drizzle for persistence |
| Team | Three devs: 3D + mobile, realtime backend, Web3 + product/integration; one shared contracts package |

## Document index

| Document | What to read it for |
|---|---|
| `BRD.md` | Outcomes, audiences, demo criteria, legal and business risks |
| `PRD.md` | User journeys, functional stories, acceptance checks, priorities |
| `GAMEPLAY_CONTROLS.md` | **Canonical** third-person camera, joystick, sprint, passing, cross-device balancing |
| `SYS.md` | Runtime boundaries, room/game state machines, authority and chain flow |
| `API_CONTRACT.md` | **Canonical** REST routes, typed Socket.IO payloads, sequence and snapshot semantics |
| `TRD.md` | Implementation choices, packages, repo, security, performance targets |
| `ERD.md` | Postgres entities, indexes, room/device telemetry and audit rules |
| `FLOWCHART.md` | Mermaid flows including mobile orientation/reconnect and start countdown |
| `design.md` | Scene look, asset sources, desktop/mobile wireframes and UI behavior |
| `QA_CROSSPLAY.md` | Mixed-device test matrix, pass/fail acceptance, fallback plans |
| `AGENT_HANDOFF.md` | Three-dev + AI agent assignments, sequencing, merge contract, demo plan |
| `DECISIONS.md` | Frozen decisions, P0/P1/P2 scope, unresolved questions |
| `CHANGELOG.md` | v0.1 → v0.3 changes |

## Delivery priority

- **P0 (ship):** cross-platform join/lobby, 3 playable clients, third-person camera, movement, sprint stamina, pass/eliminate/result, server authority, visible Monad testnet record.
- **P1 (polish):** bot behavior if people unavailable, last-3-second panic effects, spectator controls, camera occlusion, optional shrinking arena, SFX and quality selector.
- **P2 (stretch):** *real* testnet escrow with verified deposit/refund integration, achievement NFT, tournament system. No real-value bets.

## Helpful asset and tech references

- KayKit Adventurers: https://kaylousberg.itch.io/kaykit-adventurers
- Kenney asset library: https://kenney.nl/assets
- React Three Fiber: https://r3f.docs.pmnd.rs/
- Drei: https://drei.docs.pmnd.rs/
- gltfjsx: https://github.com/pmndrs/gltfjsx
- Socket.IO: https://socket.io/docs/v4/
- Monad documentation: https://docs.monad.xyz/

**Build gate:** Before three AI coding agents begin parallel implementation, merge `packages/shared` event types and get each developer to agree on `API_CONTRACT.md`.

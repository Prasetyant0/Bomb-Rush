# BOMB RUSH 3D

A 3D multiplayer bomb-survival party game for the web. 3–4 players share a compact arena, pass a timed bomb, and the last survivor wins. Desktop (WASD + mouse) and mobile browsers (joystick + swipe) play in the same match under identical server-enforced rules.

This repository is the hackathon prototype for **Monad Blitz Jogja Vol. 2**. The goal is a short, playable cross-device demo backed by an authoritative game server, with match results recorded on Monad Testnet for verifiable demo receipts. It is a prototype, not a production product: no real-value stakes, no mainnet deployment, no monetary payout.

## Monorepo structure

| Path | Responsibility |
|---|---|
| `apps/web/` | Browser frontend — 3D arena, player controls, lobby, in-match UI |
| `apps/server/` | Realtime backend — game engine, multiplayer sessions, room lifecycle |
| `packages/shared/` | Shared TypeScript types, event contracts, Zod validation schemas used by both apps |
| `contracts/` | Solidity smart contracts and their tests for match-result recording |
| `docs/` | Game specifications, API contracts, architecture decisions, integration guides |

## Planned tech stack

- **Frontend:** React, TypeScript, Three.js / React Three Fiber
- **Backend:** Node.js, TypeScript, Fastify, Socket.IO
- **Shared contracts:** Zod schemas shared between client and server
- **Smart contracts:** Solidity
- **Blockchain target:** Monad Testnet (chainId 10143) — test network only

The stack above is the working plan and may be adjusted as implementations land.

## Status

The repository is being set up: monorepo structure and team documentation first. Individual components (web frontend, server, contracts) are being developed in parallel workspaces and will be integrated here as they become ready. Nothing in this README should be read as a claim that a feature already works — features are considered done only when their implementation is merged and verified here.

Deployment status and blockchain integration are **not yet verified** and must be confirmed against the actual implementation once available.

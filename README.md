# BOMB RUSH 3D

A 3D multiplayer bomb-survival party game for the web. 3–4 players share a compact arena, pass a timed bomb, and the last survivor wins. Desktop (WASD + mouse) and mobile browsers (joystick + swipe) play in the same match under identical server-enforced rules.

This repository is the hackathon prototype for **Monad Blitz Jogja Vol. 2**. The goal is a short, playable cross-device demo backed by an authoritative game server, with match results recorded on Monad Testnet for verifiable demo receipts. It is a prototype, not a production product: no real-value stakes, no mainnet deployment, no monetary payout.

## Monorepo structure

| Path | Responsibility | State |
|---|---|---|
| `apps/web/` | Browser frontend — 3D arena, player controls, lobby, in-match UI | Playable locally, single-player sim |
| `apps/server/` | Realtime backend — game engine, multiplayer sessions, room lifecycle | Gameplay-only, no chain module |
| `packages/shared/` | Shared TypeScript types, event contracts, Zod validation schemas | Still v0.3 |
| `contracts/` | Solidity escrow (`TestnetPoolEscrow`) for the testnet pot | Implemented, 51 tests, not deployed |
| `docs/spec/` | Specification pack v0.5 — the authority for scope | v0.5 |
| `docs/` | Backend audit, integration notes, frontend checklist | v0.3 |
| `reference/` | Design material: Monad brand kit, reference frontend, moodboard | Not shipped |

`docs/spec/` is normative. `MVP_SCOPE.md` and `API_CONTRACT.md` there override
every other document on scope questions. If code and spec disagree, the code is
wrong unless the spec is updated first.

## Running

```bash
npm install          # links workspaces
npm test             # server tests + frontend sim vectors

npm run dev:web      # serve apps/web on a static server
npm run dev:server   # Fastify + Socket.IO on :3000
```

The frontend is plain ES modules with an import map — no bundler, no build step.
Serve `apps/web/` directly.

Contracts:

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge test -vvv
```

## Planned tech stack

- **Frontend:** plain ES modules + Three.js via import map (not React, as originally planned)
- **Backend:** Node.js, TypeScript, Fastify, Socket.IO
- **Shared contracts:** Zod schemas shared between client and server
- **Smart contracts:** Solidity 0.8.28, OpenZeppelin 5.7
- **Blockchain target:** Monad Testnet (chainId 10143) — test network only

## Status

This is not an integrated product yet. The three parts were built in parallel and
merged; they do not yet talk to each other.

- **Frontend** runs a local simulation. It has no wallet, no server connection, and
  no value — `app.js` uses in-memory demo credits.
- **Backend** is gameplay-only. It has no `viem`, no chain module, and an empty
  `MONAD_RPC_URL`. Nothing drives the escrow.
- **Contract** compiles, passes 51 tests including stateful invariants, and has
  never been deployed. No testnet address, no transaction hashes.

Nothing here should be read as a claim that the funded flow works. The escrow is
a trusted-oracle design: the server decides the winner and the contract only
enforces eligibility, single payment, and refundability. See
`contracts/README.md` for the exact trust model and `contracts/ABI_HANDOFF.md` for
what the backend must build to connect.

Deployment status and blockchain integration are **not yet verified**.


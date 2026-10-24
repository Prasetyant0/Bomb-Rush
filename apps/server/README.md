# apps/server — Realtime Backend

The authoritative game server for BOMB RUSH 3D: game engine, multiplayer sessions, room lifecycle (create → lobby → countdown → live → result), and realtime communication via Fastify + Socket.IO at 20 Hz.

Stack: Node.js, TypeScript, Fastify, Socket.IO, Zod, Vitest.

## Commands (from monorepo root)

```bash
npm install                                  # installs all workspaces
npm run dev --workspace @bomb-rush/server    # dev server on http://localhost:3000
npm test --workspace @bomb-rush/server       # unit + integration tests (vitest)
npm run typecheck --workspaces               # tsc --noEmit everywhere
npm run build --workspace @bomb-rush/server  # tsc → dist/
npm start  --workspace @bomb-rush/server     # run compiled dist/index.js
npm run smoke --workspace @bomb-rush/server  # full E2E client simulation (needs dev/build server running)
```

## Layout

- `src/game/domain.ts` — pure game rules (clock-injected, no I/O): rooms, countdown, bomb, pass, elimination, stamina.
- `src/game/store.ts` — in-memory rooms + the single 20 Hz authoritative loop.
- `src/net/` — Socket.IO adapter, session registry (server-minted identity), rate limits.
- `src/api/` — REST routes (`/health`, rooms, join, cancel, match result).
- `test/` — 43 tests (domain, store loop, REST, Socket.IO integration) + `frontend-smoke.ts` E2E simulation.

## Configuration

Copy `.env.example` (repo root) to `.env` for optional overrides (PORT, HOST). Persistence is in-memory by design for the hackathon MVP; PostgreSQL is a documented future step, not yet wired.

Integration contract for the frontend: `docs/BACKEND_INTEGRATION.md` and `docs/FRONTEND_INTEGRATION_CHECKLIST.md`. Security audit notes: `docs/BACKEND_AUDIT.md`.

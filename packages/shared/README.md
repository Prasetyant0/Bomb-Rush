# packages/shared — Shared Contracts

TypeScript types, Socket.IO/REST event contracts, and Zod validation schemas shared by `apps/web` and `apps/server`, so both sides agree on one source of truth for the network protocol.

## Contents (`src/index.ts`)

- `GAME_RULES` — canonical gameplay constants (speeds, stamina, bomb cycle, pass range/cooldown, countdown, arena) from TRD v0.3 §13.
- `RoomStatus`, `ParticipantKind`, error codes (`ERROR_CODES`) — the exact string values clients and server exchange.
- `socketSchemas` — Zod validators for every Socket.IO client→server payload.
- `SPAWN_POINTS` — deterministic spawn positions.

## Usage

Import as `@bomb-rush/shared` (workspace-resolved; no build step needed — both apps consume the TS source directly). Version-gate the Socket.IO handshake with `PROTOCOL_VERSION` (`"0.3"`).

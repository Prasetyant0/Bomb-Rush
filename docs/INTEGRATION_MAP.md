# Integration map — what connects to what, and what does not yet

Read this before wiring anything. It states the ground truth of the three parts as
they exist in the repo today, and every place where the v0.5 spec pack and the
actual code disagree.

**Rule of precedence:** where the spec and the code disagree, the code wins for
what *is*, and the spec wins for what *should be*. Do not silently "fix" the code
toward the spec without updating this file, because three people are building
against each other.

Sources of truth:
- Spec: `docs/spec/` (v0.5). `MVP_SCOPE.md` and `API_CONTRACT.md` override other docs on scope.
- Contract behaviour: `contracts/src/TestnetPoolEscrow.sol` + `contracts/ABI_HANDOFF.md`.
- Server wire contract: `apps/server/src/net/socketAdapter.ts` and `apps/server/src/api/routes.ts`.
- Frontend: `apps/web/app.js` + `apps/web/src/game/`.

---

## 1. The three parts, honestly

| Part | Runs? | Speaks to | State authority | Chain |
|---|---|---|---|---|
| `apps/web` | Yes, local sim | Nothing | Local sim, per-seat | None |
| `apps/server` | Yes, 43 tests pass | REST + Socket.IO | Participant-based sim | None |
| `contracts` | Compiles, 51 tests | — | Escrow only | Testnet 10143, not deployed |

The web app does not talk to the server. The server does not talk to the chain.
Each pairs correctly with itself; the seams are empty.

---

## 2. Server wire contract — as actually implemented

This is what a client must speak today. It is **v0.3**, not the v0.5 in
`docs/spec/API_CONTRACT.md`.

### Handshake

```js
io(url, { auth: { eventVersion: PROTOCOL_VERSION } })
```

`PROTOCOL_VERSION` is `'0.3'` from `packages/shared`. A mismatch disconnects with
`game:error` / `PROTOCOL_VERSION_MISMATCH`. **Not** the `'0.5'` the spec requires.

### Client → server

| Event | Payload | Notes |
|---|---|---|
| `room:subscribe` | `{ roomId: uuid, sessionToken: string }` | `roomId` is a **UUID**, validated by zod |
| `room:set_ready` | `{ ready: boolean }` | shares a rate-limit budget with subscribe |
| `player:input` | `{ sequence, moveX, moveZ, sprint }` | throttled to ~30/s server-side |
| `bomb:pass_intent` | `{ sequence }` | no target; server picks nearest |
| `match:request_snapshot` | `{ matchId: uuid }` | reconnect recovery |

### Server → client

`room:state`, `room:countdown`, `match:started`, `match:snapshot`,
`bomb:pass_accepted`, `match:event`, `match:finished`, `game:error`.

### REST as implemented

| Method | Path | Response |
|---|---|---|
| `GET` | `/health` | `{ ok, version: '0.3.1', time, rules: 'bomb-rush-v0.3' }` |
| `GET` | `/api/rooms` | `{ rooms: RoomSummary[] }` — PUBLIC only |
| `POST` | `/api/rooms` | `{ roomId, code, participantId, sessionToken, status, visibility, hostSessionId }` |
| `POST` | `/api/rooms/:roomId/join` | join result with `participantId` + `sessionToken` |
| `GET` | `/api/rooms/:roomId` | room state |
| `POST` | `/api/rooms/:roomId/cancel` | `{ status: 'CANCELED', cancelReason }` |
| `GET` | `/api/matches/:matchId/result` | match result |

**There is no escrow in any of this.** No create-confirm, no deposit-confirm, no
`/api/escrow/:roomKey`, no settlement status.

---

## 3. The identifier problem

Three different identity schemes are in play. This is the single biggest source of
integration bugs, so it is spelled out rather than left implicit.

| Layer | Room identity | Player identity |
|---|---|---|
| Frontend sim | `code` string (`"RUSH42"`) | `seat: 0..3` (integer) |
| Server | `roomId` UUID + `code` | `participantId` string (`"p_abc"`) |
| Contract | `roomKey` bytes32 | wallet `address` |
| Spec v0.5 | `roomId` string **and** `roomKey` bytes32 | `participantId` + `walletAddress` |

So a player is simultaneously a seat, a participantId, and an address — and the
room is simultaneously a code, a UUID, and a bytes32. Any adapter must hold an
explicit mapping, never assume two are equal.

`roomKey` is derived server-side:
```
roomKey = keccak256(abi.encodePacked('BOMB_RUSH_V05', chainId, serverNonce, hostAddress))
```
The contract cannot verify this (it only sees the finished 32 bytes), so the server
is solely responsible for the derivation and for rejecting a client-supplied key.

---

## 4. Where spec and code disagree

Do not resolve these unilaterally. Each changes behaviour for someone else.

| # | Topic | Spec v0.5 says | Code does | Impact |
|---|---|---|---|---|
| 1 | Protocol version | `'0.5'` | `'0.3'` | Any client built to spec is rejected at handshake |
| 2 | Arena radius | `7.0` (`API_CONTRACT` §1) | `10` in `packages/shared`, `10` in `apps/web/src/game/sim.js`, arena mesh drawn at 10 | Changing it moves spawn points and re-renders the arena |
| 3 | Snapshot rate | 15 Hz | `SNAPSHOT_HZ: 10`, adapter emits every 2 ticks | Cosmetic + bandwidth |
| 4 | Reconnect grace | 5000 ms | 3000 ms | Disconnect handling timing |
| 5 | Room identity in subscribe | `{ code, sessionToken }` | `{ roomId: uuid, sessionToken }` | Client must send UUID, not the 6-char code |
| 6 | Entry amount | `entryWei` bigint string | `virtualDemoEntryWei` — demo credits | Economic path is absent from the server |
| 7 | Escrow endpoints | `prepare`, `create-confirm`, `deposit-confirm`, `/api/escrow/:roomKey` | none | The entire funded flow is unbuilt |
| 8 | `MIN_HUMANS: 2` + demo bot fills a seat | `MIN_PLAYERS: 3` human, no bot in P0 (`DECISIONS.md` D02) | `MIN_HUMANS: 2`, `ALLOW_DEMO_BOT=true` | A room can start with 2 humans + 1 bot, contrary to D02 |
| 9 | `ARENA_RADIUS` / `PLAYER_RADIUS` in sim | `PLAYER_RADIUS: 0.4`, `MAX_POSITION_RADIUS: 6.6` | `PLAYER_RADIUS: 0.55` soft separation, clamps at `ARENA_RADIUS - PLAYER_RADIUS` | Different clamp; server and client must agree or the client jitters |
| 10 | Error codes | `PASS_TOO_LATE`, `NOT_FUNDED`, `TX_REVERTED`, … | `PASS_LOCKBACK`, `NO_PASS_TARGET`, `BAD_STATE`, … | Two vocabularies; the client cannot map server errors to spec copy |

Items 1–4 are constants: someone must decide whether to bump the code or amend the
spec. Items 5–10 are behaviour and need an owner's call, not a patch.

---

## 5. How the three parts should connect

```
 browser ──REST──► server ──viem──► TestnetPoolEscrow (10143)
    │                │
    └──Socket.IO─────┘        (authoritative game sim)
```

Ownership of each seam:

| Seam | Producer | Consumer | Contract |
|---|---|---|---|
| REST + Socket.IO | `apps/server` | `apps/web` | §2 above |
| Receipt verification | browser | `apps/server` | `ABI_HANDOFF.md` §3 — five checks, not a tx hash |
| Settlement | `apps/server` (SETTLER_ROLE key) | contract | `settle(roomKey, winner, resultHash)` |
| Payout | anyone | contract | fixed recipient = recorded winner |
| Refund | each depositor | contract | no backend needed |

The chain is **not** in the gameplay loop. No per-input chain call, ever. The
contract only learns the result after `match:finished`, and it never learns the
score.

---

## 6. What must be true before a funded demo

From `docs/spec/MVP_SCOPE.md` §"Atomic release rules" and `AUDIT_CHECKLIST.md`:

1. Contract deployed to 10143, verified, `ESCROW_DEPLOYMENT_BLOCK` recorded.
2. `forge test` green **and** one other developer reviewed every withdrawal path (`contracts/PEER_REVIEW.md`).
3. Local E2E: create → join ×2 → settle → payout, and create → join ×2 → expire → refund ×3.
4. Server receipt verification rejects a forged tx hash (wrong chain, wrong room, wrong amount).
5. Frontend never shows "paid" without a `PrizePaid` receipt.
6. Recovery without the backend: dead server, funds still withdrawable via wallet.

If any of 1–4 fails, the funded flow ships **disabled** and the demo is
gameplay-only with a banner. `docs/spec/MVP_SCOPE.md` is explicit that a
misleading partial is worse than an honest partial.

---

## 7. Run order for a local session

```bash
npm install
npm run dev:server          # :3000
npm run dev:web             # static server for apps/web
cd contracts && forge test  # 51 tests
```

Chain-dependent paths additionally need a local anvil or a deployed testnet
contract; see `contracts/README.md` and `scripts/README.md`.

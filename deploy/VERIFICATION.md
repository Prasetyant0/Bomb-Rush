# Verification Report — bomb-rush

Date: 2026-10-24
Scope: read-only verification of the committed tree. No source files were modified.
The only file written by this run is `deploy/VERIFICATION.md`.

## Summary table

| # | Check | Command | Result | Pass/Fail |
|---|-------|---------|--------|-----------|
| 1 | Server test suite | `cd apps/server && npx vitest run --reporter=dot` | 7 files passed, **140 tests passed**, 0 failed (4.01s) | PASS |
| 2 | Server typecheck | `cd apps/server && npx tsc --noEmit` | Exit 0, no diagnostics | PASS |
| 3 | Server build | `cd apps/server && npm run build` | `tsc -p tsconfig.build.json`, exit 0; `dist/index.js` present (4.0K) | PASS |
| 4 | Game sim vectors | `node apps/web/src/game/sim.test.js` | 18 ok, 0 fail, exit 0, `all vectors pass` | PASS |
| 5 | Net adapter tests | `node apps/web/src/net/adapter.test.js` | 94 ok, 0 fail, exit 0, `all adapter tests pass` | PASS |
| 6 | Escrow / wallet tests | `node apps/web/src/web3/escrow.test.js` | 100 ok, 0 fail, exit 0, `ALL PASS` | PASS |
| 7 | Contract tests | `cd contracts && forge test` | 2 suites, **51 tests passed**, 0 failed, 0 skipped (51 total), 10.20s | PASS |
| 8 | Retired identifiers in tests | `grep -rnE 'entryCredits\|recordMatch\|guestHash\|0xplaceholder'` over all test/spec files | 1 hit (see below) | NOTE |
| 9 | Constant agreement | Script over shared/protocol/sim (`C:\Users\VICTUS\AppData\Local\Temp\bombrush_constcheck.mjs`) | 0 mismatches (see table) | PASS |
| 10 | ArenaScene vs sim radius | Script + grep | Both 7 | PASS |

`dist/` was **absent** before the run and was deleted again afterwards, so the tree is left as found.

## Exact suite counts

| Suite | Pass | Fail | Skipped |
|-------|------|------|---------|
| apps/server (vitest) | 140 tests / 7 files | 0 | 0 |
| apps/web sim.test.js | 18 assertions | 0 | 0 |
| apps/web adapter.test.js | 94 assertions | 0 | 0 |
| apps/web escrow.test.js | 100 assertions | 0 | 0 |
| contracts (forge) | 51 tests / 2 suites | 0 | 0 |

Per-file vitest breakdown: domain 15, audit-regression 16, store-loop 3, chain 67, rest.routes 7, socket.integration 2, escrow.wiring 30 = 140.

Forge suite detail: `TestnetPoolEscrow.t.sol` 46 passed, `TestnetPoolEscrow.invariants.t.sol` 5 passed (each invariant at 256 runs / 25,600 calls, 0 reverts).

## Retired identifiers

Searched all files matching `*test*` / `*spec*` outside `node_modules`, `.git`, `contracts/out`, `contracts/cache`, `contracts/lib`:

- `apps/server/test/escrow.wiring.test.ts:581` — `expect(evt.resultHash).not.toBe('0xplaceholder');`

This is a **negative assertion** (the test asserts the hash is *not* the placeholder), not a live use of a retired identifier. Not a defect.

- `entryCredits`, `recordMatch`, `guestHash`: **zero hits** in any test file.
- `contracts/src` and `contracts/test`: zero hits for all four identifiers.
- Informational only, outside the test scope: `contracts/out/MatchRegistry.sol/MatchRegistry.json` is a stale build artifact for a retired contract (contains `recordMatch`/`guestHash`/`entryCredits` in its ABI/metadata); docs/spec mentions are prohibition notes. No source code uses them.

## Constant agreement

All values machine-extracted and numerically normalized, not eyeballed.

| Constant | shared/src/index.ts | net/protocol.js | game/sim.js | assets/ArenaScene.js | Verdict |
|----------|---------------------|-----------------|-------------|----------------------|---------|
| ARENA_RADIUS | `7.0` @ L38 | not defined | `7.0` @ L11 | `7` @ L12 | AGREE |
| MAX_POSITION_RADIUS | `6.6` @ L40 | not defined | `6.6` @ L13 | not defined | AGREE |
| SNAPSHOT_HZ | `15` @ L31 | `15` @ L13 | not defined | not defined | AGREE |
| RECONNECT_GRACE_MS | `5000` @ L32 | not defined | not defined | not defined | AGREE |
| PROTOCOL_VERSION | `'0.5'` @ L64 | `"0.5"` @ L6 | not defined | not defined | AGREE |

**No mismatches.** Details worth knowing (absence, not disagreement):

- `apps/web/src/net/protocol.js` deliberately mirrors only `PROTOCOL_VERSION` and `SNAPSHOT_HZ` (documented in its header comment as intentional duplication because `apps/web` has no build step). It does not carry `ARENA_RADIUS`, `MAX_POSITION_RADIUS`, or `RECONNECT_GRACE_MS`.
- `apps/web/src/game/sim.js` carries the arena constants but not `SNAPSHOT_HZ` or `RECONNECT_GRACE_MS`; it has no network responsibility.
- `RECONNECT_GRACE_MS` is consumed only server-side (`apps/server/src/game/domain.ts:281`).
- `ArenaScene.js` `ARENA_RADIUS = 7` matches `sim.js` `ARENA_RADIUS = 7.0`.

## Deviations / notes

- One stray invocation (`npm run build --prefix apps/server`) was used to double-check the build and recreated `dist/`; it was removed again and `apps/server/dist` is confirmed absent at end of run.
- The session's `rtk` hook compresses some command output; counts for vitest were re-confirmed with `rtk proxy` using the stock reporter (140 passed / 7 files).

## Verdict

**Safe to demo** — every suite passes at full count (140 server, 18 sim, 94 adapter, 100 escrow, 51 forge), typecheck and build are clean, all five shared constants agree, and the only retired-identifier hit is a negative assertion.

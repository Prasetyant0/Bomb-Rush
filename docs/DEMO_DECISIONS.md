# Demo decisions — v0.5 alignment

Decisions taken while integrating, where the v0.5 spec pack and the existing v0.3
code disagree, or where the spec did not anticipate the demo's real constraints.

Anything here is a **documented deviation**, not an oversight. If a reviewer finds
the code disagreeing with `docs/spec/`, check this file first.

---

## D1 — Arena follows the v0.5 spec: radius 7, clamp 6.6

`ARENA_RADIUS` goes from 10 to **7.0**, `PLAYER_RADIUS` from 0.55 to **0.4**.

The clamp is `MAX_POSITION_RADIUS = 6.6` on **both** sides. This matters because the
current code clamps differently in each: `domain.ts:449` clamps to
`ARENA_RADIUS` (10) and `sim.js:41` clamps to `ARENA_RADIUS - 1.0` (9.0). Those two
never agreed, so a networked client would see itself stop at a different radius than
the server enforced and snap on every snapshot. Unifying on `MAX_POSITION_RADIUS`
removes that class of bug rather than moving it.

`ArenaScene.js` must be redrawn at radius 7. The barrier torus and the platform
cylinder are both built from that constant; leaving them at 10 would show players a
rim they can never reach.

**Consequence to accept:** a 30% smaller arena makes `PASS_RANGE = 1.8` relatively
larger. The spec's own balancing work (`docs/spec/DECISIONS.md` §v0.4.1) rejected a
shrinking arena *during* a match; a smaller constant arena is a different thing, but
the pass-range ratio does shift. Do not claim the balance is unchanged.

---

## D2 — Bot may fill a seat, funded by the operator wallet, disclosed

`DECISIONS.md` D02 says 3–4 **human** players and no demo bot in P0. The team is
three people, one of whom is pitching, so a three-human match is not reliably
available at demo time.

Resolution: a bot may occupy a seat **if and only if**:

1. That seat is funded by the **operator wallet**, with a real `joinRoom` deposit.
2. The UI labels the bot seat as a bot, on the lobby, in-arena, and on the result screen.
3. If the bot wins, the prize goes to the operator wallet and the result screen says
   so plainly. No hidden redirection, no post-hoc transfer to a human — that would
   be a second transaction that looks like a bribe and is worse for a demo.

Why this keeps the contract intact: every seat is a real depositor, the winner is
always a depositor, and the pot moves exactly once. The escrow invariants are not
weakened. What changes is the *product* claim: "3 humans" becomes "2 humans + 1
disclosed bot".

**Never claim full human occupancy in the pitch.** Say "two humans and a disclosed
bot, because the team is three people".

If a third human appears at demo time, they take the seat and the bot drops out.

---

## D3 — Protocol version moves to 0.5

`PROTOCOL_VERSION` becomes `'0.5'` in `packages/shared`, and the frontend mirror in
`apps/web/src/net/protocol.js` follows. A v0.3 client is rejected at handshake, which
is the intended behaviour: silently accepting both would let a stale tab talk to a
server whose payload shapes changed.

`RULE_VERSION` becomes `'bomb-rush-v0.5'`.

---

## D4 — A single constants source, mirrored only where a build step is impossible

`packages/shared` is the source of truth for `GAME_RULES`, the escrow constants and
`PROTOCOL_VERSION`.

`apps/web` has no bundler and cannot import TypeScript, so `apps/web/src/net/protocol.js`
mirrors the subset it needs. That mirror is a known duplication risk. It is
acceptable **only** because a mismatch breaks the handshake loudly with
`PROTOCOL_VERSION_MISMATCH`. Any new mirrored constant must have the same property:
fail loudly, never fail silently.

`apps/web/src/game/sim.js` keeps its own exported constants because it is also
imported by the server's test harness. If those ever diverge from `packages/shared`,
the sim vectors (`apps/web/src/game/sim.test.js`) must catch it — that is why
`MAX_POSITION_RADIUS` is asserted there.

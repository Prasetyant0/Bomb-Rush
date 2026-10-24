# GAMEPLAY_CONTROLS — v0.5 (v0.4 Mechanics Preserved)

Pool accounting **never changes** movement, pass, countdown, collision or bomb timing. `API_CONTRACT.md` is the numeric source of truth. Neither device model nor funded amount grants a gameplay advantage.

## Match
- 3–4 funded human participants, evenly distributed spawn positions on a radius-`4.2u` ring with per-match rotational offset.
- Room must first be contract FUNDED and all ready. Server-anchored countdown **15 s**; admissions lock at its start.
- Each bomb cycle **exactly 10 s** of monotonic server clock. Passing bomb **does not reset** countdown. When timer reaches zero holder is eliminated; repeat until single survivor. 3 players: 2 eliminations ≈20 s nominal; 4 players: 3 ≈30 s nominal, excluding transitions.
- Initial holder chosen by server RNG, visibly announced. If all players disconnect/round becomes unrecoverable, **cancel**; never fabricate a payout winner. The contract can be canceled/refunded according to its state/deadline rules.

## World, movement, collision
- Flat obstacle-free circular arena radius 7; avatar physical radius .4; server clamps coordinates to radial maximum 6.6, sliding along rim; no player-player collision. World-space input vector normalized magnitude ≤1, no diagonal speed boost.
- Walk speed 4.5u/s; sprint speed 7u/s (provisional crossplay parameters). Server tick 20 Hz, snapshots 15 Hz. Input rate-limited to 30/sec.
- Third-person orbit-follow camera target at avatar+1.4u; distance 7–11u (default 9); pitch 20–65° above horizon; yaw 360°, client-only. Mouse drag (desktop) / right-side swipe (mobile).

## Controls
| Action | Desktop | Mobile landscape |
|---|---|---|
| Move | WASD | Left floating joystick |
| Sprint | Hold Shift | RUN toggle, released on joystick release/zero/focus loss |
| Pass bomb | E | PASS button |
| Camera orbit | Drag mouse | Right-side swipe free zone |
| Board (optional) | Tab | HUD icon |
| Zoom | Mouse wheel | Settings slider |

Multitouch: track separate pointer IDs for joystick, camera, RUN and PASS. Releasing one does not cancel the rest. `pointercancel` / `blur` / `visibilitychange` reset active input. Joystick touch ≥70px, RUN≥56px, PASS≥64px; safe-area insets. Gameplay uses `touch-action:none` only inside its controls. Portrait gameplay shows rotate overlay WITHOUT pausing simulation/time.

## Sprint
- 5 server-computed stamina bars, drain 1.0/s while **moving and sprinting**; recovery starts only 1.5 s after last actual sprint, then +1.0/s while not sprinting. At 0 player forced to walk; resume sprint above 0.5 to prevent flicker.
- UI never owns stamina or position; interpolate snapshots; send only input intent.

## Passing
- Only current alive holder may request passing. Server selects nearest alive eligible player in radius ≤1.8u; no target in intent. Stable tie-break by participant ID.
- Cooldown 700ms after last accepted pass; immediate return to previous holder prohibited for 1000ms. Pass intent must reach server before bombExpiresAtMs. Reject otherwise. Successful animation only after `bomb:pass_accepted`.
- Passing gives **no speed bonus**. Holder bonus experiments remain out of P0.

## Readability
Holder has bomb glyph overhead, bright outline, pulse and global countdown; never rely on color alone. Last 3s faster pulse; audio, heavy VFX optional. Eliminated player becomes read-only spectator with remaining count.

## Crossplay vectors
| ID | Action | Expected |
|---|---|---|
| GS-01 | Sprint continuously from 5 bars | Empty after ~5 s |
| GS-02 | Stop sprint and wait 1.4 s | No regen yet |
| GS-03 | Stop for 2.5 s | ~1 bar regenerated |
| GS-04 | Diagonal input `(1,1)` | Normalized magnitude ≤1 |
| GS-05 | Pass target at 2.5u | `PASS_OUT_OF_RANGE` |
| GS-06 | Immediate return within 1s | `PASS_RETURN_LOCK` |
| GS-07 | Concurrent pass requests | At most one holder |
| GS-08 | Background phone for 4s | Server timer keeps running |
| GS-09 | Rotate mid-round | Session remains; no timer pause |
| GS-10 | Spam 200 inputs/s | Rate-limit / cap applied |
| GS-11 | Cross arena boundary | Position clamped, no stuck state |
| GS-12 | Stand overlapping opponent | No player collision as specified |

**Important:** escrow-related delays occur before/after live match, never per input, and testnet balances have NO impact on player strength.

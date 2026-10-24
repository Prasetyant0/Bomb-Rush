# GAMEPLAY_CONTROLS.md — Canonical Rules & Cross-Platform Input

**Version:** v0.3. Treat this document as the gameplay contract for client, server, QA and AI agents.

## 1. Core round
1. Room accepts 3–4 participants and begins a 15-second countdown when minimum eligible seats are Ready; last joining slot locks when countdown starts.
2. Server spawns avatars at equidistant points. Bomb holder selected via server seed and announced.
3. Bomb cycle lasts exactly 10 seconds of authoritative server time. Passing never resets the timer.
4. Holder at explosion is eliminated. Repeat with survivors until one remains. Server emits a unique winner and records the match.
5. If an irrecoverable network/state failure occurs, abort with no fabricated winner.

## 2. Control mapping

| Intent | Desktop | Mobile landscape | Authoritative behavior |
|---|---|---|---|
| Move | WASD | Left floating joystick | normalized world vector, 4.5 units/s walk |
| Look/orbit | Mouse drag | Swipe right-side free area | local camera yaw and pitch only |
| Sprint | Hold Shift | RUN toggle | requires stamina; speed 7.0 units/s |
| Pass bomb | Press E once | Tap PASS button | server selects nearest eligible target ≤1.8 u |
| Scoreboard | Hold Tab | Tap compact HUD icon | client display only |
| Zoom | Mouse wheel | optional settings slider | limited 7–11 u distance, no gameplay effect |

## 3. Third-person camera math
- Follow pivot = avatar world position + target height; distance defaults to ~9 units.
- Yaw 360°, pitch/elevation 20–65° (not inverted), smooth damping; avoid wall occlusion if time permits.
- Input direction is first obtained in **camera-relative** 2D space (`right`, `forward`), transformed to world X/Z, normalized to length ≤1, then sent to backend.
- Camera orbit is client-owned and does not alter server position, collision or stamina rules. Server has authority over motion and pass distance.
- Reset camera after respawn/match join to known third-person angle; never accidentally invert swipe on mobile.

## 4. Stamina formula (server only)

**Capacity:** `0 ≤ stamina ≤ 5.0` bars; UI can render five segments with partial fill.  
**Walking:** `4.5 units/sec`; **sprint:** `7.0 units/sec`.  
**Sprint drain:** `-1.0 bar/sec` while `input.sprint === true && stamina > 0 && moving`.  
**Recovery delay:** 1.5 seconds after *last active sprint frame*; re-requesting sprint during this interval delays recovery only if actually sprinting.  
**Regen:** `+1.0 bar/sec` when not sprinting after the recovery delay; clamp to 5.0.  
**At zero:** force walking, no sprint until stamina has replenished enough to allow it (suggest reenable threshold 0.5 bar to prevent flicker).  
**Input profile:** no skill-based differences by device.

```ts
const staminaNext = (s: number, dt: number, actuallySprinting: boolean, canRegen: boolean) =>
  Math.min(5, Math.max(0, s + (actuallySprinting ? -1 : canRegen ? 1 : 0) * dt));
```

Use monotonic server clock, limit per-tick `dt` to avoid huge stamina jumps if process stalls, and send authoritative stamina in snapshots. A mobile RUN toggle is cleared locally at 0 stamina or joystick release, and after app visibility loss. **Regeneration is paused during actual sprinting.**

## 5. Passing, latency, and balance
- `bomb:pass_intent` has no trusted target. Server picks nearest **eligible** alive player within 1.8 u; deterministic tie-break by participant ID.
- A player may request pass only while holder and live. Require ≥700ms since their last successful pass. Target cannot be the last holder for 1000ms after transfer (anti-return). Do not reset 10s timer on transfer.
- Reject attempts beyond range or after explosion timestamp. Server sends `bomb:pass_accepted` or `game:error`; visually indicate successful pass only after acceptance.
- Suggest P0 proximity indicator for nearby passable players. Both PC and mobile get *same auto-target help* to avoid mouse advantage.
- Avoid adding a hidden holder movement-speed buff before testing; initial speed parity across players is easier to explain and debug.

## 6. Multi-touch requirements
- Maintain an independent registry of active Pointer Events (`pointerId`). Assign one joystick pointer, one camera pointer and allow separate RUN/PASS button pointers.
- A release/cancel of one pointer must not remove another pointer's movement state.
- Gameplay touch overlays use `touch-action: none`; outside gameplay allow ordinary page scrolling. Use pointer capture carefully, release on `pointerup`, `pointercancel`, `blur`, `visibilitychange`.
- Avoid large dead zones. Recommend ≥56px touch controls; PASS ≥64px and joystick touch region ≥70px; respect `env(safe-area-inset-*)`.

## 7. UI / feedback
- Five segment stamina display with exact server value; RUN button shows active request and depleted state, not a fictional bonus.
- Carrier has overhead bomb + red outline + sound effect and HUD timer. Last 3s: faster blinking and alarm (can be P1 polish, timer readability P0).
- Landscape gameplay; portrait displays rotate overlay without disconnecting. Camera and joystick recover after resize without leaving stale touches.
- Spectator cannot send move/pass. After elimination show who remains and allow watching the round.

## 8. Gameplay test vectors (unit/integration)
| Test | Setup | Expected |
|---|---|---|
| GS-01 | Sprint 5s continuously from full | Reach 0 energy, now forced walk |
| GS-02 | Stop sprint at t=2s, walk 1.4s | No regeneration yet |
| GS-03 | Stop sprint and walk 2.5s | 1 energy replenished (1.5s delay + 1s regen) |
| GS-04 | Send vector (1,1) | Server clamps to unit magnitude; no diagonal boost |
| GS-05 | PASS target 2.5u away | Reject |
| GS-06 | PASS to player who just passed it to you within 1s | Reject; lockback |
| GS-07 | PASS by mobile and desktop simultaneously | First valid by deterministic ordering; one holder |
| GS-08 | Lock Android screen 4s while holding bomb | Server time continues; eventually reconnect/eliminate according to existing rules |
| GS-09 | Rotate mobile during live round | One session only; buttons reset/rebind; snapshot stays authoritative |
| GS-10 | Sprint input spams 200 packets/s | Rate limited; stamina drain based on elapsed server time, not packet count |

## 9. Explicit exclusions
No physics projectile trajectories, dash skill, desktop-only core features, real-value wagering, or device-based movement boosts in MVP.

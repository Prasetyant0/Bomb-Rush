# QA_CROSSPLAY.md — P0 Device, Gameplay, and Demo Matrix

**Minimum real-device set:** Windows/macOS laptop with Chrome/Edge + Android Chrome + iPhone Safari; substitute if unavailable, but mark coverage incomplete. Same match on 3 devices is the strongest demo gate.

## A. Cross-platform smoke matrix
| ID | Scenario | Pass criterion | Priority |
|---|---|---|---|
| CP-01 | Desktop, Android, iOS open same HTTPS URL | Canvas loads, UI responsive, controls visible on each | P0 |
| CP-02 | Mobile menu portrait | Create/join/link/Ready accessible without horizontal scroll | P0 |
| CP-03 | Mobile match landscape | Joystick, PASS, RUN visible and avoid notches/toolbars | P0 |
| CP-04 | Two-thumb joystick + right camera swipe | Character moves while camera rotates; no dropped movement | P0 |
| CP-05 | Joystick + RUN + PASS combined | RUN changes speed; PASS transfers when in range | P0 |
| CP-06 | Desktop mouse drag + WASD + Shift | Camera follows/orbits, server agrees position and stamina | P0 |
| CP-07 | Cross-device proximity PASS | All screens agree bomb holder and countdown | P0 |
| CP-08 | Full match with all three device families | Countdown, pass, elimination, sole winner, explorer proof | P0 |
| CP-09 | Mobile portrait rotation mid-round | Rotate prompt shown, socket remains joined, rebind controls | P0 |
| CP-10 | iOS Safari background for 2s | Inputs cleared, reconnection snapshot, authoritative time continues | P0 |
| CP-11 | Deep-link into wallet app and return | No duplicate room member, correct room state after return | P1 |
| CP-12 | Android low graphics | Target ≥30FPS in simple scene, no UI blocking | P0 target |
| CP-13 | Invalid attempt to set winner/stamina/client time | Ignored/rejected server-side | P0 |
| CP-14 | Two PASS attempts near deadline | Server accepts at most one valid transfer | P0 |
| CP-15 | Network loss > reconnect grace | Correct elimination or controlled abort with no invented winner | P0 |

## B. Stamina tests
- Full 5 bar sprint → 5 s active sprint at 1 bar/s → 0, forced walk.
- After sprint end, 1.4 s walking yields no regen; after 2.5 s walking yields approximately +1 bar.
- Client requests sprint with zero stamina: server reports `isSprinting=false` and speed 4.5.
- 1,000 packet spam or sprint toggle exploits must not create stamina or exceed speed cap.
- Diagonal analog joystick vector clamped to ≤1; no speed difference from WASD diagonal movement.
- Regen must not operate while sprint is actually active; server values are source of truth.

## C. Room and bot test cases
- 2 humans cannot start unless host allowed a visible single bot and it joins; 1 human + 1 bot fails start.
- 3 humans start without bot; 4th human admitted only before countdown.
- Room expires with no participant fund trapped (P0 has no chain deposits).
- Label operator bot in room card, lobby, in-game and result; demo bot obeys stamina and pass rules.
- Cancelled/aborted match must not show fake winner or confirmed chain transaction.

## D. On-chain P0 gates
1. Deploy minimal registry on testnet 10143, make authorized record from server.
2. Query receipt and `MatchRecorded` event; UI displays PENDING until confirmed.
3. Repeat same match ID: on-chain duplicate must revert/no-op safely, no extra winner.
4. Invalid server key or unauthorized caller rejected.
5. Tested path to explorer URL is real and copyable on mobile.

## E. Release sequence + backout
1. E2E on local Wi-Fi / public deployment with WebSocket.
2. Complete 3 full matches across actual devices. Record fallback screen capture from one completed match **without representing it as live**.
3. Prepare QR link + manual code, test connection on venue hotspot, and keep bot available in demo-only mode.
4. If low-end iPhone WebGL underperforms, disable postprocessing/shadows and use primitive fallback avatars; retain gameplay.
5. If wallet handshake unreliable, allow guest gameplay; perform one signer-recorded match at end and show explorer proof (do not fake wallet authorization).
6. If 3-player room cannot be stabilized, disclose incomplete status and demo controlled vertical slice, not a misleading prerecorded live match.

## F. UX accessibility tests
- Toggle sound mute, legible timer and bomb glyph without color-only meaning.
- Reduced-motion mode for strong camera shake/flash; mobile touch controls large enough to use.
- Pointercancel and blur clear sticky sprint/joystick states.

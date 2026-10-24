# PRD — Product Requirements Document

## 1. Product definition
BOMB RUSH is a real-time 3D multiplayer browser arena where 3–4 participants pass a timed bomb and compete to be the last survivor. One clearly labeled operator-funded demo bot may occupy a slot in **testnet only**.

## 2. Player personas
- **Casual competitor:** wants instant, understandable, one-minute arcade action.
- **Room host:** wants invite links, selectable test-demo entry amounts, start control/status.
- **Judge:** needs quick wallet fallback and a complete proof of Monad integration.

## 3. Canonical game rules (tunable variables)
- Minimum 3 and maximum 4 players at start. At most one bot; for a bot game, ≥ 2 real humans.
- Bomb cycles start at 10.0 s. A random eligible player starts holding the bomb; selection determined by server, logged with match seed/commitment; starts after a short on-screen cue.
- Players use **WASD + Shift + E** (desktop) or **left floating joystick + RUN toggle + PASS** (mobile). Both devices rotate a third-person follow camera (desktop mouse drag, mobile right swipe). Server chooses nearest eligible pass target within 1.8 world units.
- Passing does not reset bomb timer. Successful pass cooldown is 0.7 s; anti-return to the previous holder lasts 1 s. Sprint is server-authoritative with 5 bars, consumption 1 bar/s, 1.5 s recharge delay and 1 bar/s regen only while not sprinting. Every action is server-authorized.
- Holder at explosion is eliminated and becomes a spectator. Next bomb cycle selects a remaining eligible player; repeat until one survivor.
- If all remaining participants disconnect or a round becomes unrecoverable, abort with clear testnet-refund path. Never invent a winner.

## 4. Screen requirements
| Screen | Required elements | Key actions |
|---|---|---|
| Landing | Hero, Play, Rooms, How to Play, Testnet notice | Enter game |
| Wallet/Guest | Wallet connect, network status, guest practice | Connect wallet / guest |
| Rooms | Open room cards, size, amount, capacity, human/bot policy | Join, create |
| Create Room | Presets 0.1/0.5/1/2 test MON, custom 0.01–10, private/public, consent demo bot | Create room |
| Demo deposit | Exact amount, testnet label, tx pending/confirmed/fail | Authorize test entry |
| Lobby | Invite code, list, labels (human/bot), test pool total, ready, 15 s countdown | Ready, cancel/leave |
| Arena | Third-person follow camera, 3D players, bomb, 5-bar stamina HUD, contextual controls, mobile landscape guidance | Move/sprint/pass/orbit camera |
| Result | Winner, test pool, leaderboard, claim/record status, explorer link | Rematch, home |
| Error/Recovery | Cancel reason, retry, timeout, refunds | Restore safe state |

## 5. Feature requirements / acceptance tests
**FR-01 Room creation:** Creator chooses a preset or custom numeric entry. Validation rejects decimals beyond 18 places, NaN, negatives, values outside 0.01–10; room freezes entry amount after creation. Amount is displayed as 'test MON — no real value'.

**FR-02 Join:** Participants may join only when room state is `WAITING` or `FUNDING`, with remaining capacity and unique wallet/session identity; additional joins are rejected. New joiners see exact entry and bot disclosure before any testnet signature.

**FR-03 Funding demonstration:** For optional P2 testnet escrow, creator and players submit exactly the agreed test MON and are counted as confirmed only after valid on-chain receipt / deposit event. Repeated or stale events do not double count. For **P0**, use off-chain **virtual pool points** and on-chain result recording only; label the virtual pool clearly in the UI; never imply transfer or prize payment.

**FR-04 Bot:** Only one (`participant_type=BOT`); cannot start match without ≥ 2 humans; enabled by room creator and visible in room browser/lobby; its testnet entry comes from separately designated demo treasury, never an invisible server credit. Bot uses normal move/pass cooldowns, published decision constraints, no omniscient state access. Disable bot if treasury funding unavailable.

**FR-05 Countdown:** When min participants are confirmed and each is ready, initiate 15 s server countdown. If somebody leaves/unreadies, return to lobby; do not start while an earlier deposit remains pending. At 4 players, lobby locks and countdown proceeds.

**FR-06 Gameplay:** Server accepts `player:input` (world-space movement vector plus `sprint` boolean) and `bomb:pass_intent` (no trusted target; server picks nearest eligible). It broadcasts authoritative snapshots including `stamina`, `isSprinting`, `bombHolderId` and `bombExpiresAt`. Client cannot submit authoritative `winner`, `bomb_holder`, or `exploded` state.

**FR-07 Result:** Server emits final result once; match transitions to `FINISHED` and never returns to running. Settlement service processes a match ID at most once; result includes reference to explorer URL when confirmed.

**FR-08 Cancellation:** A waiting room expires at 10 min; if testnet escrow is implemented, participants can reclaim their own test MON for a canceled room. The MVP must never strand funds, including demo funds.

**FR-09 Reliability:** If a human disconnects briefly, preserve seat for 3 s (configurable). On final timeout, auto eliminate during match; before countdown, unready and revert. Announce network errors in UI. Mobile app/background suspension and wallet-return-to-browser scenarios are required test cases.

## 6. End-to-end user story
As room creator, I connect to Monad Testnet, choose **1 test MON**, create a private room, and share its link. Two players join at the same fixed amount; optionally, a pre-disclosed bot is used instead of the third human if I enabled it. All are ready; a 15 s countdown begins. The arena loads, bomb transfers between participants, and the last survivor wins. Result and testnet record are displayed. No real money changes hands.

## 7. Explicitly out of scope
- Player-funded real MON winner-takes-all matches and real-world payouts.
- Unlabeled house bot, variable hidden bot probabilities, privileged bot controls.
- Dynamic or hidden post-join room price changes.
- Rake, odds setting, wagering affiliate funnels, real asset custody.

## 8. Critical user experience details
- Wallet not required to watch practice demo, but required for testnet identity/record.
- Always display 'TESTNET / DEMO / NO REAL VALUE' on room and result screens.
- Countdown server-side, anchored to `startAt`, not JS interval on each client.
- High-contrast bomb carrier outline; color is never sole cue (icon + particle + HUD).
- Result page includes player list, bot disclosure, actual settlement status, and any cancellation reason.


## 9. Input and interaction requirements (v0.3, P0)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-10 | Third-person camera follows active avatar; user can orbit and limited zoom | Mouse drag/scroll desktop, swipe right/right touch zone mobile; no snap or accidental scroll |
| FR-11 | Same server movement rules on every device | WASD and left joystick map to world-space normalized vector; diagonal cannot exceed configured speed |
| FR-12 | Sprint as continuous 5.0-unit resource | Shift hold / mobile RUN toggle; spend 1.0/s, recharge starts 1.5 s after sprint ends, gain 1.0/s, only when not sprinting |
| FR-13 | Contextual PASS with nearest eligible target | E / touch PASS; server validates alive, distance ≤1.8, cooldown ≥0.7 s, anti-return ≥1 s |
| FR-14 | Landscape playable mobile game | Portrait menu/lobby responsive; in-match portrait gives rotate guidance, not a browser-enforced orientation dependency |
| FR-15 | Multi-touch controls | Left joystick and right camera gesture simultaneous; PASS and RUN work while movement pointer remains down |
| FR-16 | Mixed-device match | 1 desktop + 1 Android + 1 iOS (or documented device fallback) complete a full P0 match |
| FR-17 | Performance and settings | Low preset for mobile; nominal 30 FPS mobile target, 60 desktop; no blocking postprocess |

Mobile RUN state must immediately clear when stamina reaches zero or focus is lost. The server remains authoritative even if the client optimistically animates sprint. Details are canonical in `GAMEPLAY_CONTROLS.md`.

## 10. Definition of Done for a real match
1. Host creates fixed virtual-entry room and sends link/QR.
2. Three devices join, confirm readiness, see shared 15s countdown.
3. All devices can move and rotate camera; sprint bars decrease/regenerate identically server-side.
4. Bomber passes by nearest valid target; all clients agree who holds the bomb.
5. Explosion eliminates only current holder; one winner appears; match recorded once on Monad Testnet with explorer proof.
6. No UI claims a real MON payout in P0.

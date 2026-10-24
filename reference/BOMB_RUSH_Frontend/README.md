# BOMB RUSH — Interactive Frontend Concept

A browser-ready **frontend-only design prototype** for BOMB RUSH (Monad Blitz concept). No backend, wallet, smart contract, real multiplayer, tokens, funds, payments, or recorded blockchain transactions are implemented.

## Start

**Zero install:** open `index.html` in Chrome, Edge, Firefox, or Safari. Alternatively, open the included standalone `BOMB_RUSH_Standalone_Preview.html` file from the delivery (everything except optional Google fonts is embedded).

**Local HTTP preview:** from this directory run:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Screens / navigable flow

1. **Landing:** hero, arena artwork, create, join, how to play and control guide.
2. **Create Room:** nickname, 3/4 seats, 10 / 50 / 100 / 500 virtual demo credits, custom integer 1–1000, public/private selector.
3. **Join:** nickname + six-character mock room code (`RUSH42` for local UI demonstration only).
4. **Lobby:** code sharing, mock seat list, ready state, simulated 15-second countdown, skip-to-game option for UI preview.
5. **Arena:** perspective-illustrated canvas arena, HUD, ten-second bomb countdowns, animated illustrated opponents, local movement and sprint interaction, contextual pass, score table, settings and mobile touch controls.
6. **Result:** local simulated winner, display-only virtual credits, honest *not recorded on-chain* status, rematch.

## Controls

- Desktop: **WASD** move, hold **Shift** sprint, **E** pass when near an eligible player, drag mouse to orbit, mouse wheel to zoom, **Tab** scoreboard.
- Phone landscape: left virtual stick, **RUN**, **PASS**, swipe on right side to orbit. Phone portrait in arena shows a rotate prompt. Menu pages work in portrait.
- Pass attempts use the simulated 1.8-unit range, 0.7s pass cooldown and 1s return lock. Passes **do not reset** the 10s timer.
- The five stamina bars locally mimic 1/s drain, 1.5s delay, and 1/s regen.

## Screenshots

The included screenshot PNG files show the landing page, room creator, lobby, arena (desktop/mobile) and result screen.

## Source organization

- `index.html` — semantic view markup for all screens.
- `styles.css` — responsive look and feel, layout, micro-interactions and touch HUD.
- `app.js` — view state, mock flow, input handlers and procedural Canvas scene (no external JS library).

## Visual system

- Mood: high-contrast, playful arcade competition, polished dark sci-fi.
- Colors: midnight `#090910`, plum `#171525`, lilac `#B69BFF`, hot orange `#FF7658`, mint `#BFF8A8`.
- Typography: Barlow Condensed for oversized display headings and DM Sans for UI copy, system font fallbacks available. Online Google Fonts is **optional**.

## Developer handoff / integration notes

This is a **frontend design and interaction illustration**, **not** the actual WebGL 3D multiplayer game. The arena is a lightweight perspective-projected **Canvas 2.5D mock**, not a Three.js scene. Seat names and avatar motions are simulated in a single browser, not remote humans or hidden bots. It does not demonstrate server fairness.

Production must replace local simulation with server-authoritative Socket.IO state, actual GLB/Three.js characters, orbit camera and movement, pass accepted events, join validation, pending/reconnecting/error states, and on-chain result recording status from trusted server records. Never optimistically display a confirmed chain receipt.

Matches are three to four players with **20/30 seconds of nominal gameplay** respectively, excluding the lobby countdown and transitions. Credits are always **virtual demo credits** with no value, transfer, withdrawal, redemption or payout. Monad Testnet chain ID **10143** is shown as *planned* only.

The design is intended to be reimplemented in a production frontend framework if the engineering team prefers React/Vite/TypeScript. No npm dependencies are necessary to explore this prototype.

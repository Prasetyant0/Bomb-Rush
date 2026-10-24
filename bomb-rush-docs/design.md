# design.md — BOMB RUSH 3D Cross-Platform Visual & Interaction Spec

**Version:** 0.3, 23 October 2026  
**Design promise:** A party game that looks exciting in 3 seconds and is playable on a smartphone using two thumbs. Third-person **orbit-follow** is core — fixed isometric is no longer approved.

## 1. Art direction and sources

**Style:** toy-like low-poly future sports arena, not a casino aesthetic. Purple Monad-inspired accents, dark violet stage, brightly coded avatars and intense red bomb. Bold readable HUD. All models must be original/properly licensed and unified by materials, palette and lighting.

| Asset | Candidate source | Notes |
|---|---|---|
| Rigged cartoon characters | https://kaylousberg.itch.io/kaykit-adventurers | Pick one cohesive family, use idle/run animation, verify license in downloaded archive |
| Stage / walls / obstacles | https://kenney.nl/assets | Low-poly modular packs; check each individual asset license |
| Alternative stage props | https://quaternius.com/ | Optional low-poly art, verify per pack |
| Bomb | Generate in R3F using spheres, emissive material, sparks | Avoid spending hackathon time modeling complex effects |
| GLB conversion | https://github.com/pmndrs/gltfjsx | GLB/glTF → reusable React component |
| Visual editor | https://triplex.dev/ | Optional to inspect lighting and placement; avoid blocking build on setup |

Palette: background `#111024`, panels `#211A39`, primary `#8367EF`, lavender `#B9A7FF`, danger `#FF667E`, info cyan `#63E8F2`, warning `#F6BD67`, foreground `#F7F6FF`. Type: Inter / Space Grotesk and tabular numbers for timers.

## 2. Camera and stage
- **Third-person camera** follows player from behind and above; orbit with mouse drag (desktop) and swipe (right-side mobile touch zone).
- Default distance ≈ 9 world units (adjust 7–11); horizontal 360° yaw; pitch/elevation clamp ≈ 20–65° above horizon. No upside-down orbit.
- Damped follow but no slow-input disadvantage. Camera pitch/zoom only changes view, never movement speed or server collision.
- Stage: one compact flat circular arena with mild raised rim, ≈ 20 world units wide. Keep distant obstacles minimal so mobile camera is readable.
- Remote players: clear colored outfits and overhead nameplates; current bomb holder: pulsing ring, red outline, overhead bomb glyph and readable global countdown.
- As timer hits 3 seconds, blink bomb and intensify sound/particle warning. Reduce/restrict camera shake for accessibility.
- During eliminated/spectator view, follow any live player or cycle between them if time permits; desktop/mobile matches must remain spectatable.

## 3. UI routes and content

| Route | Desktop | Mobile |
|---|---|---|
| `/` | Hero + Play, Create, Rooms, How to Play | Portrait responsive cards; visible Play/Create primary CTA |
| `/rooms` | Room list/cards, room code/share | Compact single-column; tap-friendly filters |
| `/rooms/create` | Test entry presets, custom, bot label | Numeric keypad, responsive form, fixed price confirmation |
| `/room/:code` | 3–4 seats, Ready, QR/link, countdown | Portrait/landscape both work; clear share/copy CTA |
| `/match/:id` | 3D canvas + PC HUD | **Landscape-first** 3D canvas + joystick/camera/swipe/RUN/PASS overlays |
| `/results/:id` | Podium and explorer proof | Vertical stacking, no tiny transaction controls |

All real-value-like amounts are displayed as **virtual demo points denominated in test MON**, not as real funds. If P2 genuine testnet deposits are implemented, distinguish verified chain transfer from a virtual total. No fake 'transaction confirmed' state. Operator bot labeled in room listing, lobby, match and results.

## 4. Desktop in-match HUD wireframe
```text
+---------------------------------------------------------------------------------+
| BOMB RUSH          ALIVE 3/4           BOMB 00:07.35        SCORE   SETTINGS      |
|                                                                                 |
|                 [ Third-person follow 3D arena ]                                |
|                Enemy marker    Bomb holder red ring                             |
|                                                                                 |
|                 [///// 5 sprint energy bars /////]                              |
|       WASD MOVE  | DRAG ORBIT  | SHIFT SPRINT  | E PASS   | TAB BOARD            |
|                           MONAD TESTNET — DEMO                                   |
+---------------------------------------------------------------------------------+
```

## 5. Mobile in-match HUD wireframe (landscape)
```text
+--------------------------------------------------------------------------+
| BOMB RUSH    ALIVE 3/4    BOMB 00:07.35      MENU                         |
|                                                                          |
| LEFT THUMB                Third-person arena                RIGHT SWIPE    |
| [MOVEMENT JOYSTICK]     Players + target indicator        [CAMERA AREA]   |
|                                                                          |
|       STAMINA [■][■][■][■][■]          [RUN]      [PASS]                  |
|                 MONAD TESTNET — DEMO                                     |
+--------------------------------------------------------------------------+
```

Touch zones:
- Floating **joystick** bottom left, movement target size ≥70 px; drag with left pointer, clamp displacement, recenter on release.
- Right half available for **camera swipe**, except separate action button hitboxes. One camera pointer may coexist with joystick and button pointers.
- **RUN toggle** (≥56×56 CSS px target) shows active state and server-confirmed stamina; turns off at zero or focus loss.
- **PASS** (≥64×64 CSS px target), disabled/outlined when no valid nearby target; strong highlighted targeting circle when possible.
- No heavy touch gestures that require pinch/precision to win. Zoom optional via settings slider rather than pinch.
- Keep HUD away from iOS/Android safe-area insets. Use `touch-action: none` on gameplay touch regions and restore normal scrolling outside match.

## 6. Orientation and responsive behavior
- Home, How to Play, Rooms, Create Room, Lobby and Results all support portrait and landscape mobile.
- When match is portrait: show **Rotate phone to play** overlay. Keep Socket.IO session, sound policy and server countdown alive. Do **not** depend on orientation-lock browser API.
- Resize WebGL canvas when `visualViewport` / container changes; accommodate browser bars, notch, and safe-area.
- Handle wallet deep link and return: release touch state, show reconnecting overlay, request authoritative server snapshot; never pause bomb timer for user.

## 7. Visual performance budget (targets)
| Setting | Mobile Low | Desktop Default |
|---|---|---|
| FPS goal | ≥30 | 60 |
| DPR | 1–1.5 | 1–2 |
| Characters | 3–4 models, shared materials | Same |
| Shadows | Blob shadows or one low shadow map | Low/medium real shadows |
| Particles | Few particles, no intensive bloom | Limited extra particles/bloom |
| Assets | Total core game target <10 MB | Same compressed shared assets |

Use instancing/reused materials, preloading of GLBs, no per-frame React rerenders for dozens of objects. Auto degrade to low preset if FPS drops persistently. Verify on real Android and iOS devices; emulation alone is insufficient.

## 8. Design acceptance tests
1. User recognizes current bomb holder on 6-inch landscape device even when player rotates camera.
2. One joystick finger plus second camera swipe and third tap of PASS can coexist; first movement pointer must not drop.
3. Stamina state and Sprint active state readable without looking away from game for long.
4. Joystick/RUN/PASS are not hidden under iOS browser toolbar/safe-area or system gesture edge.
5. Mobile player can fairly chase/pass a desktop player; auto-target chosen identically by server.
6. UX labels match actual transaction status and mark virtual points as virtual.
7. On rotating device, game state remains synchronized (no duplicate player, no match restart).

## 9. Component names
`ResponsiveShell`, `NetworkBanner`, `WalletButton`, `RoomCard`, `RoomCreateForm`, `BotDisclosure`, `ReadyCountdown`, `ArenaScene`, `ThirdPersonCamera`, `PlayerAvatar3D`, `BombModel`, `BombTargetIndicator`, `StaminaHUD`, `DesktopControlsGuide`, `TouchControlLayer`, `FloatingJoystick`, `RunToggle`, `PassButton`, `RotateDeviceOverlay`, `SpectatorView`, `ResultPodium`, `ChainStatusCard`.

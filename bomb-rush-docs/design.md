# design.md — UI/UX and Art Direction v0.5

## Visual system
**Brand:** BOMB RUSH — playful futuristic arcade, not a casino-style betting interface. Cartoon bomb mascot as icon (no text necessary); make it legible as favicon at 32 px and hero art separately. User-supplied Monad palette is direction, not claim of official branding approval.

| Token | Hex | Use |
|---|---|---|
| `--purple` | `#6E54FF` | Primary CTA, arena rim, accents |
| `--ink` | `#0E091C` | App canvas/background |
| `--lavender` | `#DDD7FE` | Secondary labels / highlights |
| `--pink` | `#FF8EE4` | Sparks/effects |
| `--orange` | `#FFAE45` | Fuse, warning/high pressure HUD |
| `--white` | `#FFFFFF` | Primary text |

Accessibility: pass warnings include both icon and text, WCAG contrast check; focus outlines; reduced motion option; 44px+ tap hitbox on menu. Form/transaction copy must distinguish demonstration from economic value.

## Route map
`/` landing; `/rooms/create` wallet+amount review; `/join` code; `/room/:code` funding and lobby; `/match/:matchId` gameplay; `/results/:matchId` chain/payout state; `/recover?roomKey=...` direct contract refund/claim utility. Any route reload gets state from API and contract read, not only React memory.

## Screen blueprints
**Landing:** visual mascot, "ONE BOMB. ONE WINNER."; dominant "Play on Testnet" CTA and Join Code secondary; quick how-to (10sec bomb, pass, last survivor); persistent `TESTNET ONLY · NO REAL VALUE` label.

**Create room:** two-row 3/4 seat selector; exact entry MON editable text; derived `Estimated pool = entry × seats` (bigint arithmetic); wallet address, chain chip 10143, contract address expandable; warning `Additional gas required`; CTA "Create & deposit [amount] test MON". Never create UI-only funded state before confirmed event.

**Join:** 6-char code, room cost and deposit count visible before signing. Button labeled "Deposit [amount] test MON" with wallet prompt step, tx pending spinner, retry. Display deadline countdown separately from gameplay bomb countdown.

**Lobby:** seat cards display wallet short address, `Funded` badge only after verified chain event; not a wallet screenshot claim. Reveal room code + copy, progress `2/4 deposits confirmed`, `TOTAL POOL ... test MON` with explicit `0 platform fee`, Ready disabled before funding. Countdown 15s after quorum/all ready.

**Arena:** low-poly circle radius7 with glowing purple rim; third-person orbit-follow; HUD top: Alive X/Y, Bomb `00:07.35` center, network label; bottom: 5 partial stamina bars, PC hints WASD/SHIFT/E, mobile joystick left and RUN/PASS right. Bomb carrier red/orange ring + overhead glyph. On portrait show rotate overlay, without pausing countdown.

**Result:** Victory/Eliminated state independent of settlement; steps `Result determined → On-chain settlement → Prize claimable → Payout confirmed`. Never jump steps optimistically. Display winner, number of funded seats, exact pool, settle tx, payout tx after receipts. If settlement failed, show retry guidance and the resolution deadline/refund route.

**Refund/recovery:** show roomKey with copy, actual contract status, wallet deposit membership, reason and eligibility. Buttons `Expire room` when deadline passed; `Withdraw my refund` if room canceled; show already claimed from chain. Usable when gameplay backend is down via direct public RPC.

## Responsive
- Desktop menu center max width ~1140; cards responsive. Mobile portrait menus and wallet dialogs; arena landscape-first; no explicit orientation locking.
- Mobile multitouch independent pointer IDs for joystick, camera, RUN, PASS. Respect safe areas `env(safe-area-inset-*)`, dynamic `visualViewport`, and browser bars. All important controls inside gameplay safe zone.
- Low-end fallback: primitive avatars, one light/no bloom, capped DPR. FPS target desktop 60 mobile 30. Static assets under 10MB.

## Critical status labels
| Source | UI text |
|---|---|
| tx submitted, no receipt | Waiting for network confirmation… |
| verified deposit | Deposit confirmed on Monad Testnet |
| game result, chain pending | Winner determined. Settlement pending. |
| settled, not paid | Pool allocated. Prize claimable. |
| payout receipt | Payout confirmed on testnet |
| canceled | Room canceled. Refund available. |
| expired but not canceled | Deadline passed. Anyone may expire this room. |
| RPC down | Could not verify chain status; no confirmation displayed |

## Misleading UI to avoid
No fake `LIVE` chain badges, wallet numbers representing actual credits without chain read, simulated explorer hashes, instant gas-free claims, "secured/trustless fairness" labels, or winner money animation before confirmed payout.

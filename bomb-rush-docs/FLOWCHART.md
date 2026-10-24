# FLOWCHART — Complete Player & Room Journeys

## A. Full UX flow: menu → room → play → result
```mermaid
flowchart TD
  A[Home / Landing] --> B{Choose action}
  B -->|How to Play| T[Controls tutorial: PC or mobile] --> A
  B -->|Browse| R[Room Browser]
  B -->|Create| C[Create Room]
  R --> J[Room Detail]
  C --> S[Select fixed demo entry: preset / custom]
  S --> O[Choose public/private and demo bot opt-in]
  O --> V{Input valid?}
  V -->|No| S
  V -->|Yes| W[Connect wallet / select testnet]
  J --> W
  W --> F{Demo test entry mode?}
  F -->|Off-chain points fallback| L[Enter Lobby]
  F -->|Testnet deposit prototype| D[Confirm test MON transaction]
  D --> K{Confirmed?}
  K -->|Rejected / failed| X[Error + retry / leave]
  X --> W
  K -->|Yes| L
  L --> Q{3–4 ready funded seats?}
  Q -->|No| H[Wait / share invite / transparent optional bot]
  H --> Q
  Q -->|Yes| CD[15-second server countdown]
  CD --> E{Quorum still valid?}
  E -->|No| L
  E -->|Yes| OR{Mobile portrait?}
  OR -->|Yes| ROT[Show rotate phone guidance; keep room session alive]
  OR -->|No| M[3D third-person crossplay match]
  ROT --> M
  M --> N[Last survivor]
  N --> P[Results / On-chain record status]
  P --> Z{Play again?}
  Z -->|Yes| R
  Z -->|No| A
```

## B. Room creation with bot and expiration
```mermaid
flowchart TD
  A[Host creates room] --> B[Freeze test amount, max 4, min 3]
  B --> C[Wait for participants]
  C --> D{Enough humans?}
  D -->|At least 3 humans| R[Confirm ready and demo entry]
  D -->|2 humans| BOT{Opted in to one disclosed demo bot?}
  BOT -->|Yes, wait threshold met| F[Bot demo treasury joins and funds same amount]
  BOT -->|No| T[Wait for third human]
  F --> R
  T --> C
  D -->|Less than 2| C
  C --> EX{Expired at 10 min?}
  EX -->|Yes| CA[Cancel room; refund accepted test deposits]
  EX -->|No| D
  R --> OK{All entries confirmed and ready?}
  OK -->|No| C
  OK -->|Yes| GO[Countdown begins]
```

## C. Match lifecycle
```mermaid
flowchart TD
  A[Countdown ends: 3–4 eligible players] --> B[Server selects first bomb holder]
  B --> C[Start shared 10-second bomb timer]
  C --> D{Pass intent received?}
  D -->|Yes| V{Closest eligible target? Range, lockback, cooldown valid?}
  V -->|Yes| F[Server transfers bomb; timer unchanged]
  V -->|No| C
  F --> E{Timer reached zero?}
  D -->|No| E
  E -->|No| C
  E -->|Yes| H[Eliminate current holder]
  H --> I{More than one survivor?}
  I -->|Yes| B
  I -->|No| J[Finalize winner once]
  J --> K[Match result + optional Testnet recording]
```

## D. Demo settlement / cancellation
```mermaid
flowchart TD
  A[Match status event] --> B{Outcome}
  B -->|Finished| C[Generate canonical resultHash + winner]
  C --> D[Submit match registry tx on Monad Testnet]
  D --> E{Tx confirmed?}
  E -->|No| F[Retry idempotently; show pending]
  F --> E
  E -->|Yes| G[Show transaction explorer + winner]
  B -->|Canceled / Aborted| H[Mark room ineligible for winner]
  H --> I{Any demo deposits locked?}
  I -->|Yes| J[Offer each player testnet refund claim]
  I -->|No| K[Return to rooms]
  J --> L[Verify refund receipt; prevent double claim]
  L --> K
```

## E. UX route sitemap
```mermaid
flowchart LR
  Home --> Rooms
  Home --> CreateRoom
  Home --> HowToPlay
  Rooms --> RoomDetails --> Lobby
  CreateRoom --> Lobby
  Lobby --> Arena --> Results
  Results --> Rooms
  Results --> Home
```

## F. State invariants
- `JOINED` does not mean `CONFIRMED`/`READY`.
- Bot never counts toward humans, one bot maximum.
- Transaction pending is not deposit confirmed.
- Any quorum loss before `LIVE` cancels countdown rather than forcing a start.
- `FINISHED` has one human/bot winner; `ABORTED` has no winner.
- One room has one definitive result; settlement cannot be repeated.


## G. Desktop/mobile input, stamina, and reconnect
```mermaid
flowchart TD
  A[Enter active arena] --> D{Input profile?}
  D -->|Desktop| K[WASD world move; mouse orbit; Shift hold; E PASS]
  D -->|Mobile| T[Left joystick; right swipe orbit; RUN toggle; PASS button]
  K --> N[Normalized world movement and sprint intent]
  T --> N
  N --> S[Send seq + moveX + moveZ + sprint to authoritative server]
  S --> C{Server stamina greater than zero?}
  C -->|Yes, sprint requested| DR[Speed 7; drain 1 bar per second]
  C -->|No or sprint not requested| W[Speed 4.5; regen after 1.5 seconds out of sprint]
  DR --> SNAP[Snapshot position stamina bomb holder]
  W --> SNAP
  SNAP --> UI[Client HUD and smoothing]
  UI --> BG{App backgrounded or wallet redirect?}
  BG -->|No| N
  BG -->|Yes| R[Release pointers; clear controls; reconnect]
  R --> F[Request authoritative snapshot; countdown continues]
  F --> UI
```

## H. Priority on mobile orientation
```mermaid
flowchart TD
  Home[Mobile Home portrait or landscape] --> Lobby[Create or join room]
  Lobby --> Count[Ready + countdown]
  Count --> O{Landscape screen?}
  O -->|Yes| Arena[Render play area and touch HUD]
  O -->|No| Prompt[Overlay: rotate phone, session remains joined]
  Prompt --> O
  Arena --> End[Results page responsive portrait and landscape]
```

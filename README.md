# BOMB RUSH 3D 💣

**Pass the bomb. Keep moving. Be the last one standing.**

BOMB RUSH 3D is a browser-based multiplayer survival game where 3–4 players compete in a 3D arena. Hold the bomb for too long and you're out. Pass it to another player, manage your stamina, and survive until everyone else is eliminated.

**Play now:** https://bombrush.my.id/

| Path | Responsibility | State |
|---|---|---|
| `apps/web/` | Browser frontend — 3D arena, player controls, lobby, in-match UI | Playable; wallet + escrow wired |
| `apps/server/` | Realtime backend — game engine, sessions, room lifecycle, **chain module** | 140 tests, settles on chain |
| `packages/shared/` | Shared TypeScript types, event contracts, Zod schemas | v0.5 |
| `contracts/` | Solidity escrow (`TestnetPoolEscrow`) for the testnet pot | **Deployed + verified**, 51 tests |
| `docs/spec/` | Specification pack v0.5 — the authority for scope | v0.5 |
| `docs/` | Integration map, demo decisions, backend notes | Current |
| `reference/` | Design material: Monad brand kit, reference frontend, moodboard | Not shipped |

`docs/spec/` is normative. `MVP_SCOPE.md` and `API_CONTRACT.md` there override
every other document on scope questions. Where spec and code disagree,
`docs/INTEGRATION_MAP.md` records the difference and `docs/DEMO_DECISIONS.md`
records the decision taken.

## Live deployment

- **App:** https://bombrush.my.id
- **Escrow:** `0x8c839fab937a08177c2779eef36c15d8999be8fe` on Monad Testnet (10143),
  deployed at block 73756739, source verified on Monadscan and Monadvision.
- **Proof:** `contracts/deployments/TESTNET_CANARY.md` — two complete rounds with
  real transaction hashes: a funded match settled and paid out, and a funded room
  expired and refunded to each depositor.

The escrow is a **trusted-oracle** design: the server decides the winner, and the
contract enforces only that the winner is a depositor, that the pot moves once,
and that everyone can be refunded if the match never resolves. It does not verify
gameplay and cannot detect a dishonest settler.

## Running

```bash
npm install          # links workspaces
npm test             # server tests + frontend sim vectors

npm run dev:web      # serve apps/web on a static server
npm run dev:server   # Fastify + Socket.IO on :3000
```

The frontend is plain ES modules with an import map — no bundler, no build step.
Serve `apps/web/` directly.

Contracts:

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge test -vvv
```

### Mobile

For the best experience, play in landscape mode.

- Use the left joystick to move.
- Use the run button to sprint.
- Use the pass button to pass the bomb.
- Swipe on the right side of the screen to rotate the camera.

## Features

- **3D arena:** Play in a compact third-person survival arena.
- **Multiplayer rooms:** Create a room and invite friends using a room code.
- **Timed bomb mechanic:** Pass the bomb before the countdown ends.
- **Stamina system:** Choose when to sprint and when to save your energy.
- **Desktop and mobile controls:** Play from a desktop browser or a mobile browser.
- **Real-time game server:** Game state and player interactions are handled by the backend.
- **Monad Testnet support:** Blockchain-related features use the Monad test network, not mainnet.

## Run Locally

You can run BOMB RUSH 3D on your own computer for local development and testing.

### Requirements

Install the following first:

- [Node.js](https://nodejs.org/) — version 20 or later recommended
- npm, included with Node.js
- [Git](https://git-scm.com/)

### 1. Clone the repository

Open a terminal and run:

```bash
git clone https://github.com/Prasetyant0/Bomb-Rush.git
cd Bomb-Rush
```

### 2. Install dependencies

Run this command from the project root:

```bash
npm install
```

This installs the dependencies for the monorepo workspaces.

### 3. Configure the environment

Copy the example environment file.

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**macOS / Linux**

```bash
cp .env.example .env
```

The root `.env.example` contains the backend's default configuration. You can keep the default values for a basic local setup.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Backend port | `3000` |
| `HOST` | Backend host | `0.0.0.0` |
| `ROOM_EXPIRY_SECONDS` | Room expiration time | `600` |
| `COUNTDOWN_SECONDS` | Match countdown | `15` |
| `ALLOW_DEMO_BOT` | Allow demo bot support | `true` |
| `ENABLE_REAL_VALUE_STAKES` | Real-value staking flag | `false` |
| `MONAD_RPC_URL` | Monad RPC endpoint | Empty |
| `DATABASE_URL` | Database connection string | Empty |

Do not commit your personal `.env` file or private credentials.

### 4. Build the project

From the project root, run:

```bash
npm run build
```

### 5. Start the backend

Open a terminal in the project root and run:

```bash
node apps/server/dist/index.js
```

The backend should start on port `3000` with the default configuration.

To check that it is running, open:

http://localhost:3000/health

### 6. Start the frontend

Open a **second terminal** in the project root and run:

```bash
npm run dev --workspace=apps/web
```

Open the local URL printed in the terminal by the frontend development server.

Keep both terminals running while using the locally hosted game. If the frontend cannot connect to the backend, check the frontend's server URL configuration and make sure it points to your local backend.

> If you want to test blockchain-related features locally, configure the appropriate Monad Testnet RPC and wallet settings as required by the application. Use testnet assets only.

## Run Tests

The repository includes workspace scripts for testing, type checking, and building.

Run these commands from the project root:

```bash
npm test
npm run typecheck
npm run build
```

## Technology Stack

| Technology | Role |
|---|---|
| React and TypeScript | Frontend application |
| Three.js / React Three Fiber | 3D game environment |
| Node.js and Fastify | Backend server and HTTP API |
| Socket.IO | Real-time multiplayer communication |
| Zod | Shared data validation |
| Solidity | Smart contracts |
| Monad Testnet | Blockchain network integration |

## Project Structure

```text
Bomb-Rush/
├── apps/
│   ├── web/             # Frontend and 3D game
│   └── server/          # Multiplayer backend
├── packages/
│   └── shared/          # Shared types and validation
├── contracts/           # Smart contracts
├── docs/                # Project documentation
├── .env.example         # Example environment configuration
├── package.json
├── package-lock.json
└── README.md
```

## Network and Safety

BOMB RUSH 3D is designed for gameplay and testing on Monad Testnet. Testnet assets have no intended real-world monetary value. Do not send mainnet funds or share your wallet's private key or recovery phrase.

## Built at

**Monad Blitz Jogja Vol. 2**

BOMB RUSH 3D — One bomb, a few players, and no room for hesitation.

Linkedin Post: https://lnkd.in/p/gY6q26MP

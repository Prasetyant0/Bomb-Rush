// PROTOCOL_VERSION mirror of packages/shared/src/index.ts.
// apps/web has no build step and cannot import the TS package, so this constant
// is duplicated deliberately. If the shared value changes the handshake will
// fail loudly with game:error PROTOCOL_VERSION_MISMATCH — which is the point.
// Keep in sync with docs/DEMO_DECISIONS.md D3.
export const PROTOCOL_VERSION = "0.5";

export const GAME_RULES = {
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 4,
  PASS_COOLDOWN_MS: 700,
  SERVER_TICK_HZ: 20,
  SNAPSHOT_HZ: 15, // server emits every ceil(SERVER_TICK_HZ / SNAPSHOT_HZ) ticks
};

// Escrow bounds, v0.5. The contract is the authority — read `entryBounds()` from
// it before trusting these. They exist here only so the UI can reject obviously
// invalid input without a round trip.
export const ENTRY_MIN_WEI = 10n ** 15n; // 0.001 test MON
export const ENTRY_MAX_WEI = 10n ** 16n; // 0.01 test MON
export const ENTRY_DEFAULT_WEI = "1000000000000000"; // 0.001

// socket.io-client is loaded from a CDN at runtime (no bundler, no npm install
// for the web app). Version is PINNED to the server's own client version so the
// protocol parser matches. `?server=` or a socketFactory override can bypass it.
export const SOCKET_IO_URL = "https://cdn.jsdelivr.net/npm/socket.io-client@4.8.4/dist/socket.io.esm.min.js";

/** Same origin as the page (so REST + socket share the server), else localhost. */
export function defaultUrl() {
  if (typeof location !== "undefined" && location.origin && location.origin !== "null") return location.origin;
  return "http://localhost:3000";
}

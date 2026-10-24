// net/index.js — public surface of the networking layer + the mode flag.
//
// Mode selection (checked in this order):
//   1. ?net=1 / ?net=0 query param  → forces networked / local
//   2. localStorage.netMode = '1' | '0'  → sticky preference
//   3. default: LOCAL sim (the demo must never depend on a live server)
//
// app.js uses isNetworked() to decide whether to call connectNetworkedMatch()
// or keep the original local bootMatch() path. If the server is unreachable the
// session factory throws and app.js falls back to the local sim.
export { createGameSocket, createEmitter, INPUT_HZ } from "./socket.js";
export { createAdapter, mapSeats, lerp, bindEngineRoom, MAX_SEATS, SNAPSHOT_INTERP_HZ } from "./adapter.js";
export { createRoomApi, RoomApiError } from "./room.js";
export { PROTOCOL_VERSION } from "./protocol.js";

import { createGameSocket } from "./socket.js";
import { createAdapter, bindEngineRoom } from "./adapter.js";
import { createRoomApi } from "./room.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { defaultUrl } from "./socket.js";

const LS_KEY = "netMode";

function readQuery(name) {
  if (typeof location === "undefined") return null;
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

function readLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  } catch {
    return null; // private mode / blocked storage
  }
}

/** True when the app should talk to the real server. Default: false. */
export function isNetworked() {
  const q = readQuery("net");
  if (q === "1" || q === "true") return true;
  if (q === "0" || q === "false") return false;
  return readLocalStorage() === "1";
}

/** Persist the choice so `?net=1` sticks for the demo session. */
export function setNetworked(on) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, on ? "1" : "0");
  } catch { /* storage unavailable: query param still works per navigation */ }
}

/** Server origin: ?server=http://host:port overrides, else page origin. */
export function serverUrl() {
  return readQuery("server") || defaultUrl();
}

/**
 * Convenience for app.js: one call wires REST + socket + adapter.
 * Caller still owns (and must call) session.dispose().
 *
 * @param {object} opts
 * @param {string} opts.roomId
 * @param {string} opts.sessionToken
 * @param {string} opts.participantId
 * @param {Record<string,string>} [opts.names] - participantId → display name
 * @param {object} [opts.api] - engine bootMatch() return value to bind (optional)
 */
export function createNetworkedMatch({ roomId, sessionToken, participantId, names = {}, api = null, url = serverUrl() }) {
  if (!roomId || !sessionToken) throw new Error("roomId and sessionToken are required to go online");
  const adapter = createAdapter({ localParticipantId: participantId ?? null, names });
  const net = createGameSocket({ url, roomId, sessionToken });

  net.on("match:snapshot", (snap) => adapter.applySnapshot(snap, { receivedAtMs: Date.now() }));
  net.on("room:state", (state) => adapter.applyRoomState(state));
  net.on("bomb:pass_accepted", (p) => adapter.applyPassAccepted(p));

  net.connect();
  net.subscribe();

  let bridge = null;
  const bind = (targetApi) => {
    bridge?.detach();
    bridge = bindEngineRoom({
      api: targetApi,
      adapter,
      // Local intent goes OUT; nothing is integrated locally. setInput stores
      // the latest value and the socket loop transmits it at ≤30 Hz.
      onLocalInput: (intent) => net.setInput(intent),
    });
  };
  if (api) bind(api);

  return {
    net,
    adapter,
    protocolVersion: PROTOCOL_VERSION,
    bindEngine: bind,
    /** Pass is an intent, never simulated: server resolves target/cooldown. */
    pass: () => net.pass(),
    dispose() {
      bridge?.detach();
      bridge = null;
      net.disconnect();
    },
  };
}

/** One-shot reachability probe for the fallback decision in app.js. */
export async function serverReachable(url = serverUrl(), timeoutMs = 1500) {
  const api = createRoomApi({ baseUrl: url });
  const timer = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const probe = api.health().then(() => true).catch(() => false);
  return Promise.race([probe, timer]);
}

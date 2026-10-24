// net/room.js — REST helpers for the ACTUAL server routes
// (apps/server/src/api/routes.ts). Kept dumb: no retries, no invented fields.
//
//   GET  /health                     → { ok, version, time, rules }
//   GET  /api/rooms?status=          → { rooms: RoomSummary[] }  (PUBLIC only)
//   POST /api/rooms                  → 201 { roomId, code, participantId, sessionToken,
//                                             status, visibility, hostSessionId,
//                                             roomKey: string|null }
//        body { visibility?: 'PUBLIC'|'PRIVATE', virtualDemoEntryWei: string,
//               allowDemoBot?: boolean, hostWalletAddress?: address,
//               roomKey?: bytes32 }  ← client-supplied; verified on chain by the server
//   POST /api/rooms/:roomId/join     → 200 { participantId, sessionToken, room }
//        body { kind?: 'HUMAN'|'DEMO_BOT', walletAddress?: address }
//   POST /api/rooms/:roomId/deposit-confirm → { confirmed, idempotent, escrowStatus, room }
//        body { txHash: 0x…64, walletAddress: address } — the server verifies the
//        receipt itself; a hash is not accepted as proof on its own.
//   GET  /api/rooms/:roomId          → { room: RoomPublicState } | 404
//   POST /api/rooms/:roomId/cancel   → { canceled: true } (host only)
//   GET  /api/matches/:matchId/result→ { matchId, status, winnerId, virtualPool, roomKey,
//                                        chainRecord:{state,escrowStatus,explorerUrl} }
//
// NOTE: the spec's /api/rooms/prepare, /join-intent, /ready, /leave and
// /api/escrow/:roomKey routes DO NOT EXIST in the server. Do not call them.
// Room lookup is by roomId (uuid), not by 6-char code.
import { defaultUrl, ENTRY_DEFAULT_WEI } from "./protocol.js";

export class RoomApiError extends Error {
  constructor(status, code, detail) {
    super(`${code}${detail ? `: ${Array.isArray(detail) ? detail.join("; ") : detail}` : ""}`);
    this.name = "RoomApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] - defaults to the page origin / localhost:3000
 * @param {(input: string, init?: object) => Promise<Response>} [opts.fetchImpl]
 */
export function createRoomApi({ baseUrl = defaultUrl(), fetchImpl = globalThis.fetch } = {}) {
  const base = String(baseUrl).replace(/\/+$/, "");

  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new RoomApiError(0, "NETWORK_ERROR", err?.message ?? "fetch failed");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new RoomApiError(res.status, json?.error ?? `HTTP_${res.status}`, json?.detail ?? json?.message);
    }
    return json;
  }

  return {
    baseUrl: base,

    /** GET /health — used by the app to decide whether networking is available. */
    health() {
      return request("GET", "/health");
    },

    /** GET /api/rooms — public room summaries only (PRIVATE is filtered server-side). */
    listRooms(status) {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      return request("GET", `/api/rooms${q}`);
    },

    /**
     * POST /api/rooms — host a room. The host is joined immediately by the
     * server, so the response carries the host's participantId + sessionToken.
     * @param {object} [opts]
     * @param {string} [opts.virtualDemoEntryWei] - decimal wei string 1e16..1e19
     * @param {boolean} [opts.allowDemoBot]
     * @param {'PUBLIC'|'PRIVATE'} [opts.visibility]
     * @param {string} [opts.hostWalletAddress] - optional; when present the
     *   server binds the room to this host and can escrow.
     * @param {string} [opts.roomKey] - the bytes32 key the HOST created on
     *   chain. The server verifies it against getRoom/entryBounds; it never
     *   derives it.
     */
    createRoom({
      virtualDemoEntryWei = ENTRY_DEFAULT_WEI,
      allowDemoBot = false,
      visibility = "PUBLIC",
      hostWalletAddress = null,
      roomKey = null,
    } = {}) {
      if (!/^[0-9]{1,22}$/.test(String(virtualDemoEntryWei))) {
        return Promise.reject(new RoomApiError(400, "BAD_PAYLOAD", "virtualDemoEntryWei must be a decimal string"));
      }
      const body = { visibility, virtualDemoEntryWei: String(virtualDemoEntryWei), allowDemoBot: !!allowDemoBot };
      // Only sent when a real wallet exists: the server rejects a malformed one,
      // and an absent field means "walletless demo room", which is valid.
      if (hostWalletAddress) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(hostWalletAddress))) {
          return Promise.reject(new RoomApiError(400, "BAD_PAYLOAD", "hostWalletAddress must be a 20-byte hex address"));
        }
        body.hostWalletAddress = String(hostWalletAddress);
      }
      if (roomKey) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(String(roomKey))) {
          return Promise.reject(new RoomApiError(400, "BAD_PAYLOAD", "roomKey must be a 32-byte hex string"));
        }
        body.roomKey = String(roomKey);
      }
      return request("POST", "/api/rooms", body);
    },

    /** POST /api/rooms/:roomId/join — seat a player (or the single demo bot). */
    joinRoom(roomId, kind = "HUMAN", walletAddress = null) {
      const body = { kind };
      if (walletAddress) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(walletAddress))) {
          return Promise.reject(new RoomApiError(400, "BAD_PAYLOAD", "walletAddress must be a 20-byte hex address"));
        }
        body.walletAddress = String(walletAddress);
      }
      return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/join`, body);
    },

    /**
     * POST /api/rooms/:roomId/deposit-confirm — submit a tx hash for receipt
     * verification. The server checks chain, contract, roomKey, payer and amount
     * and returns `confirmed` only when all of them hold. A hash alone is never
     * treated as proof.
     */
    confirmDeposit(roomId, txHash, walletAddress) {
      return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/deposit-confirm`, {
        txHash: String(txHash),
        walletAddress: String(walletAddress),
      });
    },

    /** GET /api/rooms/:roomId — authoritative lobby state (participants, status). */
    getRoom(roomId) {
      return request("GET", `/api/rooms/${encodeURIComponent(roomId)}`);
    },

    /** POST /api/rooms/:roomId/cancel — host-only, requires the minted token. */
    cancelRoom(roomId, participantId, sessionToken) {
      return request("POST", `/api/rooms/${encodeURIComponent(roomId)}/cancel`, { participantId, sessionToken });
    },

    /** GET /api/matches/:matchId/result — FINISHED rooms only. */
    matchResult(matchId) {
      return request("GET", `/api/matches/${encodeURIComponent(matchId)}/result`);
    },
  };
}

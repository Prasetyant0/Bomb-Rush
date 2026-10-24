// abi.js — the minimum ABI surface this app needs, hand-written.
//
// Why not viem: apps/web has no bundler. viem's ESM entry pulls bare specifiers
// that the page import map would have to mirror by hand (and its sub-paths are
// many); `three` and `socket.io-client` are the only vetted CDN modules. Since
// the app needs exactly three encoders (createRoom, joinRoom, entryBounds-style
// static calls) and one tuple decoder (getRoom), writing them here is smaller
// than the failure modes of a half-working CDN import.
//
// Everything here is pinned against real `cast` output in escrow.test.js.

import { keccak256Utf8, keccak256Hex, fromHex } from "./keccak.js";

export const SELECTORS = {
  createRoom: "0x391702ce", // keccak("createRoom(bytes32,uint8,uint256,uint64,uint64)")[:4]
  joinRoom: "0x4b29b4c4", // keccak("joinRoom(bytes32)")[:4]
  entryBounds: "0x00a39963", // keccak("entryBounds()")[:4]
  getRoom: "0xad9a2866", // keccak("getRoom(bytes32)")[:4]
  getRoomDepositors: "0x2cfef069",
  hasDeposited: "0x05ce4d51",
  maxFundingWindowSec: "0x3079eb56",
  maxResolutionWindowSec: "0x54d054fa",
};

/** 0x-hex (or decimal bigint/number) → 32-byte word hex, no 0x prefix. */
function word(value) {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new RangeError("ABI: negative value");
  if (v >= 1n << 256n) throw new RangeError("ABI: value exceeds uint256");
  return v.toString(16).padStart(64, "0");
}

/** address → 40 hex chars (PACKED encoding — no left padding). */
export function packAddress(addr) {
  const h = String(addr).replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`ABI: invalid address ${addr}`);
  return h;
}

/** address → 32-byte word (left padded). Rejects anything that is not 20 bytes. */
export function encodeAddress(addr) {
  const h = String(addr).replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`ABI: invalid address ${addr}`);
  return h.padStart(64, "0");
}

/** bytes32 → 32-byte word. Rejects wrong length: a silent pad would misroute funds. */
export function encodeBytes32(hex) {
  const h = String(hex).replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`ABI: bytes32 must be 32 bytes, got ${h.length / 2}`);
  return h;
}

export function encodeUint8(n) { return word(BigInt(n)); }
export function encodeUint64(n) { return word(BigInt(n)); }
export function encodeUint256(n) { return word(BigInt(n)); }

/**
 * createRoom(bytes32 roomKey, uint8 seats, uint256 entryWei,
 *            uint64 fundingDeadline, uint64 resolutionDeadline) payable
 * @returns {string} 0x-prefixed calldata
 */
export function encodeCreateRoom({ roomKey, seats, entryWei, fundingDeadline, resolutionDeadline }) {
  const seatsN = Number(seats);
  if (!Number.isInteger(seatsN) || seatsN < 3 || seatsN > 4) {
    throw new Error(`ABI: seats must be 3 or 4, got ${seats}`);
  }
  return (
    SELECTORS.createRoom +
    encodeBytes32(roomKey) +
    encodeUint8(seatsN) +
    encodeUint256(entryWei) +
    encodeUint64(fundingDeadline) +
    encodeUint64(resolutionDeadline)
  );
}

/** joinRoom(bytes32 roomKey) payable */
export function encodeJoinRoom(roomKey) {
  return SELECTORS.joinRoom + encodeBytes32(roomKey);
}

/** getRoom(bytes32 roomKey) — static call data. */
export function encodeGetRoom(roomKey) {
  return SELECTORS.getRoom + encodeBytes32(roomKey);
}

/** Split a 0x-hex return blob into 32-byte chunk strings. */
function chunks(hexBody) {
  const out = [];
  for (let i = 0; i < hexBody.length; i += 64) out.push(hexBody.slice(i, i + 64));
  return out;
}

/**
 * Decode `entryBounds() -> (uint256 min, uint256 max)`.
 * @param {string} data 0x-prefixed return data
 * @returns {{minWei: bigint, maxWei: bigint}}
 */
export function decodeEntryBounds(data) {
  const body = String(data).replace(/^0x/i, "");
  const c = chunks(body);
  if (c.length < 2) throw new Error("ABI: entryBounds returned fewer than 2 words");
  return { minWei: BigInt("0x" + c[0]), maxWei: BigInt("0x" + c[1]) };
}

/** Decode `maxFundingWindowSec()/maxResolutionWindowSec() -> uint64`. */
export function decodeUint64(data) {
  const body = String(data).replace(/^0x/i, "");
  if (body.length < 64) throw new Error("ABI: missing uint64 word");
  return BigInt("0x" + body.slice(0, 64));
}

/**
 * Decode `getRoom(bytes32) -> Room` (single static tuple, so all 12 fields are
 * inline words in declaration order — no offset indirection).
 *
 * struct Room {
 *   address host; uint8 maxSeats; uint8 depositCount; uint256 entryWei;
 *   uint256 potWei; uint64 fundingDeadline; uint64 resolutionDeadline;
 *   EscrowStatus status; address winner; bytes32 resultHash;
 *   bytes32 cancelReason; bool prizePaid;
 * }
 */
export function decodeRoom(data) {
  const c = chunks(String(data).replace(/^0x/i, ""));
  if (c.length < 12) throw new Error(`ABI: getRoom returned ${c.length} words, want 12`);
  const uint = (w) => BigInt("0x" + w);
  const addr = (w) => "0x" + w.slice(24);
  return {
    host: addr(c[0]),
    maxSeats: Number(uint(c[1])),
    depositCount: Number(uint(c[2])),
    entryWei: uint(c[3]),
    potWei: uint(c[4]),
    fundingDeadline: uint(c[5]),
    resolutionDeadline: uint(c[6]),
    status: Number(uint(c[7])), // 0 NONE, 1 FUNDING, 2 FUNDED, 3 SETTLED, 4 CANCELED
    winner: addr(c[8]),
    resultHash: "0x" + c[9],
    cancelReason: "0x" + c[10],
    prizePaid: uint(c[11]) !== 0n,
  };
}

/** Decode `getRoomDepositors(bytes32) -> address[]`. */
export function decodeAddressArray(data) {
  const body = String(data).replace(/^0x/i, "");
  const c = chunks(body);
  if (c.length < 3) return [];
  const len = Number(BigInt("0x" + c[1]));
  const out = [];
  for (let i = 0; i < len && 2 + i < c.length; i++) out.push("0x" + c[2 + i].slice(24));
  return out;
}

/** Decode a bool return word. */
export function decodeBool(data) {
  const body = String(data).replace(/^0x/i, "");
  if (body.length < 64) throw new Error("ABI: missing bool word");
  return BigInt("0x" + body.slice(0, 64)) !== 0n;
}

function utf8Hex(str) {
  let hex = "";
  for (const b of new TextEncoder().encode(str)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * roomKey = keccak256(abi.encodePacked("BOMB_RUSH_V05", uint256 chainId,
 *                                      uint256 nonce, address host))
 *
 * Mirrors `apps/server/src/escrow/roomKey.ts:deriveRoomKey` exactly, types
 * included (the ABI_HANDOFF §10 "nonce has no type" open item is pinned here as
 * uint256). The browser does NOT normally derive the key: the server returns
 * the canonical `roomKey` on room creation and that is what must be used. This
 * helper exists so the two derivations can be compared, and is pinned by a
 * viem-generated vector in escrow.test.js.
 */
export function deriveRoomKey({ nonce, host, chainId = 10143, tag = "BOMB_RUSH_V05" }) {
  const packed = "0x" + utf8Hex(tag) + encodeUint256(BigInt(chainId)) + encodeUint256(BigInt(nonce)) + packAddress(host);
  return keccak256Hex(packed);
}

/**
 * Random 32-byte nonce as a uint256. The host generates this in the browser:
 * the roomKey is the room's on-chain identity, so it must exist before the
 * first deposit and must not be reused.
 */
export function randomNonce() {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Short display form of a bytes32: 0x1234…abcd. Never used for anything else. */
export function shortKey(key, lead = 8, tail = 6) {
  const s = String(key ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return s || "—";
  return `${s.slice(0, 2 + lead)}…${s.slice(-tail)}`;
}

/** Sanity check for a 0x tx hash; used before any explorer link is built. */
export function isTxHash(x) {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
}

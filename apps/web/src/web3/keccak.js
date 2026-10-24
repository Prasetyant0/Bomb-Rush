// keccak.js — self-contained Keccak-256 (the pre-standard padding used by
// Ethereum), no bundler and no CDN. apps/web has no build step, and the only
// third-party ESM modules on the import map are `three` and `socket.io-client`;
// viem cannot be imported without a bundler (its package entry uses bare
// sub-dependencies), so the small amount of hashing/encoding this app needs is
// implemented here and pinned by test vectors in escrow.test.js.
//
// This is NOT SHA3-256: Ethereum uses the original Keccak padding (0x01), not
// NIST SHA-3's 0x06. The test vectors below are the reason to trust that.

const MASK = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets, indexed R[x][y], in bits.
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotl(x, n) {
  if (n === 0) return x & MASK;
  const b = BigInt(n);
  return ((x << b) | (x >> (64n - b))) & MASK;
}

/** In-place Keccak-f[1600] permutation on a 5x5 array of 64-bit BigInt lanes. */
function keccakF(A) {
  const C = new Array(5);
  const D = new Array(5);
  const B = [[], [], [], [], []];
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) C[x] = A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x][y] ^= D[x];
    // rho + pi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y][(2 * x + 3 * y) % 5] = rotl(A[x][y], R[x][y]);
      }
    }
    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y] & MASK) & B[(x + 2) % 5][y]);
      }
    }
    // iota
    A[0][0] ^= RC[round];
  }
}

function emptyState() {
  return [
    [0n, 0n, 0n, 0n, 0n],
    [0n, 0n, 0n, 0n, 0n],
    [0n, 0n, 0n, 0n, 0n],
    [0n, 0n, 0n, 0n, 0n],
    [0n, 0n, 0n, 0n, 0n],
  ];
}

function bytesToBigIntLE(bytes) {
  let out = 0n;
  for (let i = 0; i < 8; i++) out |= BigInt(bytes[i] ?? 0) << BigInt(8 * i);
  return out;
}

const RATE_BYTES = 136; // 1088-bit rate for Keccak-256

/**
 * @param {Uint8Array|number[]} input
 * @returns {Uint8Array} 32-byte digest
 */
export function keccak256Bytes(input) {
  const msg = Array.from(input, (b) => b & 0xff);
  const msgLen = msg.length;
  // Keccak padding: 0x01 at the message end, 0x80 at the last byte of the block.
  // When the message is one byte short of the block the two land on the same
  // byte and combine to 0x81 — so this XORs into the padding bytes instead of
  // pushing them (pushing adds a spurious byte in that case).
  const padded = Math.ceil((msgLen + 1) / RATE_BYTES) * RATE_BYTES;
  while (msg.length < padded) msg.push(0x00);
  msg[msgLen] ^= 0x01;
  msg[padded - 1] ^= 0x80;

  const A = emptyState();
  for (let off = 0; off < msg.length; off += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane++) {
      const x = lane % 5;
      const y = Math.floor(lane / 5);
      const chunk = msg.slice(off + lane * 8, off + lane * 8 + 8);
      A[x][y] ^= bytesToBigIntLE(chunk);
    }
    keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane++) {
    const x = lane % 5;
    const y = Math.floor(lane / 5);
    let v = A[x][y];
    for (let i = 0; i < 8; i++) {
      out[lane * 8 + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return out;
}

/** UTF-8 string → 0x-prefixed lowercase keccak-256 hex. */
export function keccak256Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  return toHex(keccak256Bytes(bytes));
}

/** Uint8Array → 0x-prefixed lowercase hex. */
export function toHex(bytes) {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** 0x-hex (odd length allowed) → Uint8Array. */
export function fromHex(hex) {
  let h = String(hex).replace(/^0x/i, "");
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** keccak256 of raw 0x-hex input (concatenation of ABI-packed parts). */
export function keccak256Hex(hex) {
  return toHex(keccak256Bytes(fromHex(hex)));
}

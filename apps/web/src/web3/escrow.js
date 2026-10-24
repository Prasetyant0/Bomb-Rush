// web3/escrow.js — the contract-facing half of the funded room flow.
//
// Runs against an EIP-1193 provider only (eth_call / eth_sendTransaction); no
// viem, no bundler. See abi.js for why, and escrow.test.js for the vectors that
// pin the calldata against real `cast sig` output.
//
// Nothing in here invents chain state:
//   - amounts are validated against `entryBounds()` read from the contract;
//   - every write is guarded by chainId === 10143;
//   - reads return raw decoded values, never defaults that look like success.

import {
  SELECTORS,
  encodeCreateRoom,
  encodeJoinRoom,
  encodeGetRoom,
  decodeEntryBounds,
  decodeRoom,
  decodeAddressArray,
  decodeBool,
  decodeUint64,
  deriveRoomKey,
  randomNonce,
  shortKey,
  isTxHash,
} from "./abi.js";

export const MONAD_CHAIN_ID = 10143;
export { deriveRoomKey, randomNonce, shortKey };

/**
 * Deployed escrow (Monad Testnet 10143, verified on chain: code present,
 * entryBounds() = 1e15..1e16 wei). `?escrow=0x…` overrides it for a rehearsal
 * deploy; nothing else may inject an address.
 */
export const DEFAULT_ESCROW_ADDRESS = "0x8c839fab937a08177c2779eef36c15d8999be8fe";

export function escrowAddressFromEnv(env = globalThis) {
  const fromQuery = (() => {
    if (typeof location === "undefined") return null;
    try { return new URLSearchParams(location.search).get("escrow"); } catch { return null; }
  })();
  const raw = fromQuery || env?.ESCROW_ADDRESS || env?.VITE_ESCROW_ADDRESS || DEFAULT_ESCROW_ADDRESS;
  const s = String(raw).trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.toLowerCase();
  // A malformed override must never silently become "configured".
  return null;
}

/**
 * Deadlines: the contract takes UNIX SECONDS as uint64, the browser speaks ms.
 *
 * The deployed contract's caps are EXACTLY 600 s and 1200 s (verified on
 * 0x8c83…e8fe). `createRoom` requires `fundingDeadline <= block.timestamp +
 * maxFundingWindowSec`, and block.timestamp is later than the browser's clock
 * by the time the tx is mined. `now + 600` therefore reverts with BadDeadlines.
 * A 60 s margin makes `now + 540` / `now + 1140` always legal.
 */
export const DEADLINE_MARGIN_SEC = 60;
export const FUNDING_WINDOW_SEC = 600 - DEADLINE_MARGIN_SEC;       // 540
export const RESOLUTION_WINDOW_SEC = 1200 - DEADLINE_MARGIN_SEC;   // 1140

/**
 * Contract deadlines in seconds. Deliberately integer-only: `Date.now()` is ms
 * and `Math.floor` is the single conversion point, so no fractional second can
 * reach a uint64 encoder.
 */
export function computeDeadlines(nowMs = Date.now(), fundingSec = FUNDING_WINDOW_SEC, resolutionSec = RESOLUTION_WINDOW_SEC) {
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const fundingDeadline = nowSec + BigInt(fundingSec);
  const resolutionDeadline = nowSec + BigInt(resolutionSec);
  return { nowSec, fundingDeadline, resolutionDeadline };
}

/**
 * @param {object} opts
 * @param {{request: Function}} opts.wallet  - createWallet() instance (or bare EIP-1193 wrapper)
 * @param {string} opts.escrowAddress        - 0x + 40 hex
 * @param {number} [opts.chainId]            - required chain, default 10143
 */
export function createEscrow({ wallet, escrowAddress, chainId = MONAD_CHAIN_ID }) {
  if (!escrowAddress) throw new Error("ESCROW_NOT_CONFIGURED: no escrow address (?escrow=0x…)");
  if (!wallet?.request) throw new Error("NO_WALLET");

  const request = (method, params) => wallet.request(method, params);

  /**
   * Hard guard before every write. Reads the live chainId; never trusts a
   * cached value. Throws CHAIN_MISMATCH so the UI can block the deposit button.
   */
  async function assertChain() {
    const hex = await request("eth_chainId", []);
    const live = typeof hex === "number" ? hex : parseInt(String(hex), 16);
    if (live !== chainId) {
      const err = new Error(`CHAIN_MISMATCH: wallet on ${live}, need ${chainId}`);
      err.code = "CHAIN_MISMATCH";
      err.actualChainId = live;
      throw err;
    }
    return live;
  }

  async function ethCall(data) {
    const out = await request("eth_call", [{ to: escrowAddress, data }, "latest"]);
    if (!out || out === "0x") throw new Error("EMPTY_RETURN: no contract at " + escrowAddress);
    return out;
  }

  async function readBounds() {
    return decodeEntryBounds(await ethCall(SELECTORS.entryBounds));
  }

  /**
   * Wait until a transaction is mined and report whether it succeeded.
   *
   * Nothing downstream may treat a tx hash as proof of anything: the server
   * verifies deposits by reading the chain, and an unmined key reads back as
   * `status: NONE`, which the server correctly rejects. Returning the hash
   * without this wait made every create/join fail with HTTP 400 while the
   * transaction was still pending.
   *
   * Polls because Monad mines fast and `eth_getTransactionReceipt` returns null
   * until it does. Bounded so a stuck tx surfaces as an error, not a hang.
   */
  async function waitForReceipt(txHash, { timeoutMs = 90_000, intervalMs = 750 } = {}) {
    const started = Date.now();
    for (;;) {
      const receipt = await request("eth_getTransactionReceipt", [txHash]).catch(() => null);
      if (receipt && receipt.blockNumber) {
        // status is "0x1" on success; a reverted tx still mines and still has a
        // hash, so a caller that ignored this would report a failed deposit as
        // confirmed.
        if (receipt.status !== "0x1") {
          throw Object.assign(new Error("TX_REVERTED: " + txHash), {
            code: "TX_REVERTED",
            txHash,
          });
        }
        return receipt;
      }
      if (Date.now() - started > timeoutMs) {
        throw Object.assign(new Error("TX_TIMEOUT: " + txHash), {
          code: "TX_TIMEOUT",
          txHash,
        });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function createRoom({ roomKey, seats, entryWei, fundingDeadline, resolutionDeadline }) {
    await assertChain();
    const amount = BigInt(entryWei);
    const data = encodeCreateRoom({ roomKey, seats, entryWei: amount, fundingDeadline, resolutionDeadline });
    const from = wallet.getAddress?.() || (await request("eth_accounts", []))[0];
    if (!from) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
    const txHash = await request("eth_sendTransaction", [{
      from,
      to: escrowAddress,
      value: "0x" + amount.toString(16),
      data,
    }]);
    if (!isTxHash(txHash)) throw new Error("BAD_TX_HASH: provider returned " + String(txHash));
    // Do not return until the room exists on chain, or the server's read of the
    // supplied roomKey will find status NONE and reject the room.
    await waitForReceipt(txHash);
    return { txHash, roomKey, entryWei: amount };
  }

  async function joinRoom(roomKey, entryWei) {
    await assertChain();
    let amount;
    if (entryWei !== undefined && entryWei !== null) {
      amount = BigInt(entryWei);
    } else {
      const room = await decodeRoom(await ethCall(encodeGetRoom(roomKey)));
      amount = room.entryWei;
    }
    if (amount <= 0n) throw new Error("ROOM_ENTRY_ZERO: refusing to send 0");
    const from = wallet.getAddress?.() || (await request("eth_accounts", []))[0];
    if (!from) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
    const txHash = await request("eth_sendTransaction", [{
      from,
      to: escrowAddress,
      value: "0x" + amount.toString(16),
      data: encodeJoinRoom(roomKey),
    }]);
    if (!isTxHash(txHash)) throw new Error("BAD_TX_HASH: provider returned " + String(txHash));
    // Same reason as createRoom: the server reads the chain to confirm the
    // deposit, so a pending tx reads as "not deposited".
    await waitForReceipt(txHash);
    return { txHash, roomKey, entryWei: amount };
  }

  return {
    escrowAddress,
    chainId,

    /** entryBounds() → { minWei, maxWei } read from the contract, not hardcoded. */
    readBounds,

    /** createRoom(...) payable; msg.value == entryWei exactly. */
    createRoom,

    /** maxFundingWindowSec() / maxResolutionWindowSec() → seconds. */
    async readWindows() {
      const [funding, resolution] = await Promise.all([
        ethCall(SELECTORS.maxFundingWindowSec).then(decodeUint64),
        ethCall(SELECTORS.maxResolutionWindowSec).then(decodeUint64),
      ]);
      return { maxFundingWindowSec: funding, maxResolutionWindowSec: resolution };
    },

    /** getRoom(roomKey) → decoded Room struct. */
    readRoom(roomKey) {
      return decodeRoom(ethCall(encodeGetRoom(roomKey)));
    },

    /** getRoomDepositors(roomKey) → address[] */
    async readDepositors(roomKey) {
      return decodeAddressArray(await ethCall(SELECTORS.getRoomDepositors + roomKey.replace(/^0x/, "")));
    },

    /** hasDeposited(roomKey, player) → bool */
    async hasDeposited(roomKey, player) {
      const data = SELECTORS.hasDeposited + roomKey.replace(/^0x/, "") + player.replace(/^0x/, "").toLowerCase().padStart(64, "0");
      return decodeBool(await ethCall(data));
    },

    /**
     * Validate a proposed entry against the LIVE contract bounds.
     * Returns `{ ok, reason?, minWei?, maxWei? }`; never throws for bad input.
     */
    async validateEntry(entryWei) {
      let bounds;
      try {
        bounds = await readBounds();
      } catch (err) {
        return { ok: false, reason: "BOUNDS_UNAVAILABLE", error: err?.message || String(err) };
      }
      let amount;
      try { amount = BigInt(entryWei); } catch { return { ok: false, reason: "AMOUNT_NOT_INTEGER", ...bounds }; }
      if (amount <= 0n) return { ok: false, reason: "AMOUNT_ZERO", ...bounds };
      if (amount < bounds.minWei) return { ok: false, reason: "AMOUNT_BELOW_MIN", ...bounds };
      if (amount > bounds.maxWei) return { ok: false, reason: "AMOUNT_ABOVE_MAX", ...bounds };
      return { ok: true, ...bounds };
    },

    /**
     * Build the room's on-chain identity in the browser:
     *   roomKey = keccak256(abi.encodePacked("BOMB_RUSH_V05", 10143, nonce, host))
     * The host owns this value now; the server must be told it (create-confirm)
     * rather than deriving its own.
     */
    makeRoomKey(host, nonce = randomNonce()) {
      const addr = host || wallet.getAddress?.();
      if (!addr) throw Object.assign(new Error("NO_ACCOUNT"), { code: "NO_ACCOUNT" });
      return { roomKey: deriveRoomKey({ nonce, host: addr, chainId }), nonce };
    },

    /**
     * createRoom with browser-computed deadlines (UNIX seconds). `nowMs` is
     * injectable for tests; production callers omit it.
     */
    async createRoomNow({ roomKey, seats, entryWei }, nowMs = Date.now()) {
      const d = computeDeadlines(nowMs);
      // Inline rather than `this.createRoom` so the method survives destructuring.
      return createRoom({ roomKey, seats, entryWei, fundingDeadline: d.fundingDeadline, resolutionDeadline: d.resolutionDeadline });
    },

    /** joinRoom(bytes32), msg.value == entryWei (read from the room, not assumed). */
    joinRoom,

    /**
     * @internal Test hook only: the exact receipt gate createRoom/joinRoom use.
     * Exposed so a never-mining provider can be proven to time out on a short
     * clock instead of the production 90 s. Not part of the app surface.
     */
    _waitForReceipt: waitForReceipt,
  };
}

/**
 * Explorer link — only built when a real hash exists. Returns null otherwise;
 * the UI must render "not yet recorded on-chain" instead of a dead link.
 * The base URL is configurable because DEMO_RUNBOOK requires it to be verified
 * against a real transaction before the demo.
 */
export const EXPLORER_TX_BASE = "https://testnet.monadscan.com/tx/";

export function explorerTxUrl(txHash, base = EXPLORER_TX_BASE) {
  if (!isTxHash(txHash)) return null;
  return base.replace(/\/+$/, "") + "/" + txHash;
}

/**
 * Chain state for the result screen — a pure projection of server facts.
 *
 * Server vocabulary (apps/server/src/escrow/settlement.ts ChainStatusEvent):
 *   SETTLING | CONFIRMED | FAILED
 * Older result payloads used PENDING. Both are accepted; everything is
 * normalized to one of:
 *   PENDING   - nothing recorded yet (no event, or SETTLING)
 *   CONFIRMED - a MatchSettled receipt was verified
 *   PAID      - CONFIRMED plus a PrizePaid receipt
 *   FAILED    - the attempt failed; NOT a chain fact (ABI_HANDOFF §7)
 *
 * A state that claims a receipt it does not carry is downgraded, never trusted:
 * CONFIRMED without a settle hash → PENDING; PAID without a payout hash →
 * CONFIRMED. `mismatch` records that the downgrade happened.
 */
export function settlementState({ chainRecord } = {}) {
  const raw = String(chainRecord?.state ?? "").toUpperCase();
  const settleTx = chainRecord?.settleTxHash ?? chainRecord?.txHash ?? null;
  const payoutTx = chainRecord?.prizePaidTxHash ?? chainRecord?.payoutTxHash ?? null;

  let state;
  if (raw === "FAILED") state = "FAILED";
  else if (raw === "PAID") state = isTxHash(payoutTx) ? "PAID" : "CONFIRMED";
  else if (raw === "CONFIRMED" || raw === "CLAIMABLE" || raw === "SETTLED") state = "CONFIRMED";
  else if (raw === "REFUNDABLE" || raw === "REFUNDED") state = raw;
  else state = "PENDING"; // "", "PENDING", "SETTLING", anything unknown

  let mismatch = false;
  if (state === "CONFIRMED" && !isTxHash(settleTx)) { state = "PENDING"; mismatch = true; }
  if (raw === "PAID" && !isTxHash(payoutTx)) mismatch = true;

  return {
    state,
    settleTxHash: isTxHash(settleTx) ? settleTx : null,
    payoutTxHash: isTxHash(payoutTx) ? payoutTx : null,
    mismatch,
  };
}

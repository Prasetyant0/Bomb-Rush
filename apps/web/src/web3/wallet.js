// web3/wallet.js — injected EIP-1193 wallet (window.ethereum).
//
// Deliberately dependency-free and non-blocking: every failure mode the demo can
// hit (no provider, user rejects, wrong chain, wallet locked) resolves to a
// descriptive state instead of a thrown error the flow controller must catch.
// The app must still run its local demo with no wallet at all.
//
// Chain: Monad Testnet only. 10143.

export const MONAD_TESTNET = {
  chainId: 10143,
  chainIdHex: "0x279f",
  name: "Monad Testnet",
  rpcUrls: ["https://testnet-rpc.monad.xyz"],
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  blockExplorerUrls: ["https://testnet.monadvision.com"],
};

// ERC-1193 / EIP-1474 error codes worth naming (MetaMask et al.).
export const WALLET_ERRORS = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
};

export function friendlyWalletError(err) {
  const code = err?.code;
  if (code === WALLET_ERRORS.USER_REJECTED) return "Permintaan ditolak di wallet.";
  if (code === WALLET_ERRORS.UNAUTHORIZED) return "Wallet belum mengizinkan akun ini. Buka wallet dan setujui.";
  if (code === WALLET_ERRORS.UNSUPPORTED_METHOD) return "Wallet tidak mendukung metode ini.";
  if (code === WALLET_ERRORS.DISCONNECTED) return "Wallet terputus.";
  if (code === WALLET_ERRORS.CHAIN_DISCONNECTED) return "Wallet tidak terhubung ke jaringan ini.";
  const msg = err?.message || String(err);
  if (/already pending/i.test(msg)) return "Permintaan sebelumnya masih terbuka di wallet.";
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}

function parseChainId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const s = String(value);
  const n = s.startsWith("0x") || s.startsWith("0X") ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} [opts]
 * @param {any}    [opts.provider] - override (tests / non-injected wallets)
 * @param {number} [opts.chainId]  - required chain, default Monad Testnet
 */
export function createWallet({ provider, chainId = MONAD_TESTNET.chainId } = {}) {
  const injected = () => provider ?? (typeof window !== "undefined" ? window.ethereum : undefined);
  const listeners = new Set();
  const chainListeners = new Set();
  const state = { address: null, chainId: null, connected: false, lastError: null };

  function emit() {
    for (const fn of listeners) {
      try { fn({ ...state }); } catch (e) { console.warn("[wallet] listener", e); }
    }
  }
  function emitChain() {
    for (const fn of chainListeners) {
      try { fn(state.chainId); } catch (e) { console.warn("[wallet] chain listener", e); }
    }
  }

  async function request(method, params) {
    const p = injected();
    if (!p?.request) throw Object.assign(new Error("NO_PROVIDER"), { code: "NO_PROVIDER" });
    return p.request({ method, params });
  }

  async function readChainId() {
    const hex = await request("eth_chainId");
    state.chainId = parseChainId(hex);
    return state.chainId;
  }

  // Registered lazily on the first successful connect so a page that never opens
  // a wallet does not hold listeners on window.ethereum.
  let wired = false;
  function wireProviderEvents() {
    if (wired) return;
    const p = injected();
    if (!p?.on) return;
    wired = true;
    p.on("accountsChanged", (accounts) => {
      const next = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : null;
      if (next === state.address) return;
      state.address = next;
      state.connected = !!next;
      emit();
    });
    p.on("chainChanged", (hex) => {
      state.chainId = parseChainId(hex);
      emitChain();
      emit();
    });
    p.on("disconnect", () => {
      state.address = null;
      state.connected = false;
      emit();
    });
  }

  return {
    get isAvailable() {
      return !!injected()?.request;
    },
    get address() { return state.address; },
    get chainId() { return state.chainId; },
    /** True only when a wallet is connected AND on the required chain. */
    get isReady() {
      return state.connected && state.chainId === chainId;
    },
    get lastError() { return state.lastError; },
    requiredChainId: chainId,

    getAddress() { return state.address; },

    /** eth_chainId for the connected provider, or null when there is none. */
    async getChainId() {
      if (!injected()?.request) return null;
      try { return await readChainId(); } catch { return state.chainId; }
    },

    /**
     * Request accounts. Never throws: returns
     * `{ ok, address?, chainId?, error? }` so the caller can render a banner.
     */
    async connect() {
      state.lastError = null;
      if (!injected()?.request) {
        state.lastError = "NO_PROVIDER";
        emit();
        return { ok: false, error: "NO_WALLET" };
      }
      try {
        const accounts = await request("eth_requestAccounts");
        const address = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : null;
        if (!address) {
          state.lastError = "NO_ACCOUNT";
          emit();
          return { ok: false, error: "NO_ACCOUNT" };
        }
        state.address = address;
        state.connected = true;
        wireProviderEvents();
        await readChainId();
        emit();
        emitChain();
        return { ok: true, address: state.address, chainId: state.chainId };
      } catch (err) {
        state.connected = false;
        state.lastError = friendlyWalletError(err);
        emit();
        return { ok: false, error: state.lastError, code: err?.code };
      }
    },

    /** Read-only (no prompt): restore a previously authorized account on reload. */
    async restore() {
      if (!injected()?.request) return { ok: false, error: "NO_WALLET" };
      try {
        const accounts = await request("eth_accounts");
        if (!Array.isArray(accounts) || !accounts[0]) return { ok: false, error: "NO_ACCOUNT" };
        state.address = String(accounts[0]);
        state.connected = true;
        wireProviderEvents();
        await readChainId();
        emit();
        emitChain();
        return { ok: true, address: state.address, chainId: state.chainId };
      } catch (err) {
        return { ok: false, error: friendlyWalletError(err) };
      }
    },

    /** Local disconnect. Injected wallets have no true disconnect; this forgets the address. */
    disconnect() {
      state.address = null;
      state.connected = false;
      state.lastError = null;
      emit();
    },

    /**
     * Switch to the required chain, adding it if the wallet does not know it.
     * Returns `{ ok, chainId?, added?, error? }`.
     */
    async ensureChain() {
      if (!injected()?.request) return { ok: false, error: "NO_WALLET" };
      try {
        const current = await readChainId();
        if (current === chainId) return { ok: true, chainId: current };
        try {
          await request("wallet_switchEthereumChain", [{ chainId: MONAD_TESTNET.chainIdHex }]);
        } catch (err) {
          // 4902 = chain unknown to the wallet → add it, then switch again.
          const unknown = err?.code === 4902 || /Unrecognized chain|not added|Try adding/i.test(err?.message || "");
          if (!unknown) {
            state.lastError = friendlyWalletError(err);
            emit();
            return { ok: false, error: state.lastError, code: err?.code };
          }
          await request("wallet_addEthereumChain", [{
            chainId: MONAD_TESTNET.chainIdHex,
            chainName: MONAD_TESTNET.name,
            rpcUrls: MONAD_TESTNET.rpcUrls,
            nativeCurrency: MONAD_TESTNET.nativeCurrency,
            blockExplorerUrls: MONAD_TESTNET.blockExplorerUrls,
          }]);
          await request("wallet_switchEthereumChain", [{ chainId: MONAD_TESTNET.chainIdHex }]);
        }
        const after = await readChainId();
        emitChain();
        emit();
        return { ok: after === chainId, chainId: after, added: true };
      } catch (err) {
        state.lastError = friendlyWalletError(err);
        emit();
        return { ok: false, error: state.lastError, code: err?.code };
      }
    },

    /** Fires with the full state on connect/account change, chain changes, disconnect. */
    onAccountChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Fires with the numeric chainId whenever it changes. */
    onChainChange(fn) {
      chainListeners.add(fn);
      return () => chainListeners.delete(fn);
    },

    /** Escape hatch for escrow.js: raw EIP-1193 request. */
    request,
  };
}

export function truncateAddress(addr, lead = 6, tail = 4) {
  if (!addr) return "—";
  const s = String(addr);
  if (s.length <= lead + tail + 2) return s;
  return `${s.slice(0, lead)}…${s.slice(-tail)}`;
}

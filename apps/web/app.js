// BOMB RUSH — single-page flow adapted from reference/BOMB_RUSH_Frontend (screens:
// home → create → lobby → arena → result + how-to-play modal + toasts + touch HUD),
// but gameplay runs on the project's own authoritative sim (src/game/sim.js) rendered
// through the project's own 3D assets (src/assets/*). No Canvas-2.5D renderer here.
import { bootMatch } from "./src/game/engine.js";
import { bootLobbyPreview } from "./src/game/lobbyPreview.js";
import { SFX } from "./src/game/sfx.js";
import { makeRoom, addPlayer, startRound, step, pass, input, PASS_RANGE } from "./src/game/sim.js";
import { isNetworked, createNetworkedMatch, createRoomApi, serverReachable, serverUrl } from "./src/net/index.js";
import { createWallet, truncateAddress, MONAD_TESTNET, friendlyWalletError } from "./src/web3/wallet.js";
import { createEscrow, escrowAddressFromEnv, explorerTxUrl, settlementState, shortKey } from "./src/web3/escrow.js";

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn, opt) => $(id).addEventListener(ev, fn, opt);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // ==== flow state (mirrors the reference screens) ====
  const AI_NAMES = ["NOVA", "ECHO", "JINX"];
  const SEAT_COLORS = ["#b59aff", "#97e7d1", "#f6bd67", "#ffa6c7"];
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const state = {
    screen: "home", nick: "RUSHER", players: 4, credits: 100, bot: true,
    code: "RUSH42", ready: false, lobbyDeadline: 0, countdown: false,
    bet: 0, betInput: "", // MON bet for seat 0; typed value kept here so a re-render can't wipe it
    game: null, // {room, avatars, api,...} once arena is up
    paused: false, soundOn: true,
    // networked mode (?net=1 / localStorage.netMode): null until a room exists
    netMode: isNetworked(), net: null, netRoom: null, netState: null,
    // funded path: only active when a wallet is connected AND an escrow address
    // is configured; otherwise the local demo is untouched.
    wallet: createWallet(),
    escrow: null,           // createEscrow() instance, lazily built
    escrowAddress: escrowAddressFromEnv(),
    bounds: null,           // { minWei, maxWei } read from the contract
    entryWei: null,         // bigint chosen on the create screen
    funded: null,           // { txHash, entryWei, roomKey, depositConfirmed }
    chainRecord: null,      // last chain:status / match result we actually received
  };
  const MON = 10n ** 18n;
  const fmtMon = (wei) => {
    if (wei === null || wei === undefined) return "—";
    const w = BigInt(wei);
    const whole = w / MON;
    const frac = (w % MON).toString().padStart(18, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : String(whole);
  };

  // Banner so the demo never lies about which path is running.
  function netPill() {
    const el = document.querySelector(".netpill");
    if (!el) return;
    el.innerHTML = state.net
      ? `<i></i> ONLINE · ${state.net.net.isConnected ? "TERHUBUNG" : "MENYAMBUNG…"}`
      : `<i></i> MONAD TESTNET · ${state.netMode ? "LOKAL (SERVER OFF)" : "DEMO"}`;
  }

  // ==== navigation (same screen choreography, Indonesian copy) ====
  // lobby reads state.code lazily — freezing it at boot pinned the URL to the
  // seed code even after "BUAT ROOM" generated a new one
  const ROUTES = { home: "/", create: "/rooms/create", get lobby() { return "/room/" + state.code; }, arena: "/match", result: "/results" };
  function navigate(next) {
    state.screen = next;
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === "screen-" + next));
    document.body.classList.toggle("playing", next === "arena");
    if (next === "home") location.hash = "";
    else if (ROUTES[next]) location.hash = ROUTES[next];
    if (next === "lobby") { renderLobby(); if (state.funded) refreshDepositors(); }
    if (next === "result") renderResult();
    if (next === "create") loadBounds();
    // A guest arriving on ?net=1&room=<roomId> has no seat yet. Bind it on the
    // way into the lobby, otherwise the join row never appears: prepareNetRoom
    // used to be reachable only from startNetworkedArena, so a guest had to
    // detour through the arena before they could join.
    if (next === "lobby" && !state.netRoom && state.netMode) {
      prepareNetRoom().then((ok) => { if (ok) { renderLobby(); if (state.funded) refreshDepositors(); } });
    }
    // leaving the match stops its loop and music — otherwise arcade_chase keeps
    // playing underneath the menu bed (engine.stop keeps the renderer for reuse)
    if (next !== "arena") leaveArena();
    syncPreview(next);
    menuMusic(MENU_SCREENS.includes(next));
  }

  // crossing the 768px breakpoint toggles the panel without a navigation
  matchMedia("(min-width: 769px)").addEventListener("change", () => syncPreview(state.screen));

  // ==== toast (both lobby and in-arena) ====
  let toastTimer = 0;
  function toast(msg, inGame = false) {
    const el = inGame ? $("hToast") : $("toaster");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2300);
  }

  // ==== arena (three.js) is instantiated once and reset per match ====
  let boot3d = null;
  function ensureGame() {
    if (boot3d) return boot3d;
    boot3d = bootMatch($("gl")); // engine.js owns its own fixture-scoped room/sim and returns the api
    return boot3d;
  }

  // ==== create screen selection state ====
  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-action]");
    if (act) { e.preventDefault(); processAction(act.dataset.action); return; }
    const players = e.target.closest("[data-players]");
    if (players) { state.players = +players.dataset.players; refreshCreate(); return; }
    const credits = e.target.closest("[data-credits]");
    if (credits) { state.credits = +credits.dataset.credits; $("fCustom").value = ""; refreshCreate(); return; }
    const bot = e.target.closest("[data-bot]");
    if (bot) { state.bot = bot.dataset.bot === "fun"; refreshCreate(); return; }
    const mono = e.target.closest("[data-mono]");
    if (mono) {
      // Preset in MON → exact wei, via a decimal string so nothing is lost to
      // float math. 0.001/0.005/0.01 are exactly representable anyway.
      const [whole, frac = ""] = mono.dataset.mono.split(".");
      const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
      setEntryWei(wei);
    }
  });
  function refreshCreate() {
    document.querySelectorAll("[data-players]").forEach((b) => b.classList.toggle("sel", +b.dataset.players === state.players));
    document.querySelectorAll("[data-credits]").forEach((b) => b.classList.toggle("sel", +b.dataset.credits === state.credits));
    document.querySelectorAll("[data-bot]").forEach((b) => b.classList.toggle("sel", (b.dataset.bot === "fun") === state.bot));
    $("fErr").textContent = "";
  }
  on("fCustom", "input", (e) => { const n = +e.target.value; if (Number.isInteger(n) && n >= 1 && n <= 1000) { state.credits = n; refreshCreate(); } });
  on("fNick", "keydown", (e) => { if (e.key === "Enter") processAction("confirm-create"); });
  function readName() { return ($("fNick").value || "").trim().replace(/\s+/g, " ").slice(0, 16); }

  function newCode() { return Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(""); }

  // ==== lobby seat list ====
  // Two render paths share one markup:
  //   funded  - every seat's state comes from the server roster (kind,
  //             walletAddress, funded, escrowStatus). A seat without a verified
  //             deposit can never be shown ready.
  //   demo    - the original local illustration, honestly labelled as such.
  //
  // The audit_fe branch added its own EIP-1193 "wallet gate" and a bet form that
  // only recorded a number locally. Both are superseded by src/web3/ on this
  // branch, which signs real escrow deposits; keeping them would have shipped a
  // second, non-functional wallet path next to the working one.

  // ==== menu music — lobby_chill on home/create/lobby; the arena keeps arcade_chase ====
  const MENU_SCREENS = ["home", "create", "lobby"];
  let menuSfx = null; // built after the first gesture — autoplay would be blocked
  function menuMusic(on) {
    if (!menuSfx || !on || !state.soundOn) { menuSfx?.stopMusic(); return; }
    menuSfx.music("lobby_chill");
  }
  const unlock = () => {
    removeEventListener("pointerdown", unlock);
    removeEventListener("keydown", unlock);
    menuSfx = SFX({ on: state.soundOn });
    menuMusic(MENU_SCREENS.includes(state.screen));
  };
  addEventListener("pointerdown", unlock);
  addEventListener("keydown", unlock);

  // ==== gameplay preview — one panel + one WebGL context, parked into the
  // .preview-slot of whichever screen is showing (create and lobby share it) ====
  const PREVIEW_SCREENS = ["create", "lobby"];
  let preview = null;
  function syncPreview(next) {
    // slots are display:none on mobile, so the context is never created there
    const wide = matchMedia("(min-width: 769px)");
    const slot = wide.matches && PREVIEW_SCREENS.includes(next) ? $("screen-" + next).querySelector(".preview-slot") : null;
    const panel = $("previewPanel");
    if (slot) slot.appendChild(panel);
    panel.hidden = !slot;
    if (slot && !preview) preview = bootLobbyPreview($("lbPreview"));
    preview?.setActive(!!slot);
  }

  // The audit_fe branch put a "bet" form here that only stored a number in
  // memory and toasted "menunggu backend mengirim tx". No transaction was ever
  // created. The funded path on this branch is the real one: the host's
  // createRoom call in src/web3/escrow.js, and the join button that follows a
  // verified deposit. A second form that accepts a MON figure and does nothing
  // is exactly the kind of UI that makes a demo look like it took money when it
  // did not, so it is removed rather than wired.

  // ==== lobby seat list (same render as reference, honest local-mock labels) ====
  function escapeHTML(x) { return String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }

  function seatMarkup({ name, initial, color, you, sub, fund, status, cls }) {
    return `<div class="seat${you ? " you" : ""}${cls ? " " + cls : ""}">
      <i style="--sc:${color}">${escapeHTML(initial)}</i>
      <div><b>${escapeHTML(name)}${you ? " (KAMU)" : ""}${fund ? ` <span class="fund ${fund.cls}">${fund.label}</span>` : ""}</b>
        <small>${sub}</small></div>
      <small class="st${status.ok ? "" : " wait"}">${status.label}</small></div>`;
  }

  function renderLobby() {
    $("lbCode").textContent = state.code;
    // A funded room is rendered from the roster even before this player has
    // deposited: a guest needs to see which seats are already funded.
    const funded = !!state.funded;
    const roster = state.netState?.participants;
    const useRoster = funded && Array.isArray(roster) && roster.length > 0;
    const seats = useRoster ? roster.length : state.players;
    $("lbOcc").textContent = String(seats).padStart(2, "0") + " / " + String(state.players).padStart(2, "0");

    const list = $("lbSeats");
    list.innerHTML = "";

    if (useRoster) {
      roster.forEach((p, i) => {
        const me = p.participantId === state.netRoom?.participantId;
        const isBot = p.kind === "DEMO_BOT";
        const name = me ? state.nick : isBot ? "BOT DEMO" : `PEMAIN ${i + 1}`;
        // Server-side truth only: a seat is funded when the roster reports a
        // wallet AND the room's escrow status has advanced past FUNDING. The
        // bot's wallet is the operator's, and is disclosed as such.
        const fundState = roomSeatFunding(p);
        list.insertAdjacentHTML("beforeend", seatMarkup({
          name, initial: name[0], color: SEAT_COLORS[i % SEAT_COLORS.length], you: me,
          sub: `${isBot ? "BOT DEMO · DIDANAI WALLET OPERATOR" : "PEMAIN"}<br><span class="walletaddr">${p.walletAddress ? truncateAddress(p.walletAddress) : "wallet belum terikat"}</span>`,
          fund: fundState,
          status: fundState?.ok ? { ok: true, label: "✓ FUNDED" } : { ok: false, label: fundState?.label ?? "BELUM DIDANAI" },
          cls: fundState?.ok ? "" : "unfunded",
        }));
      });
    } else {
      for (let i = 0; i < state.players; i++) {
        const me = i === 0;
        const name = me ? state.nick : AI_NAMES[i - 1];
        const ready = me ? state.ready : true;
        list.insertAdjacentHTML("beforeend", seatMarkup({
          name, initial: name[0], color: SEAT_COLORS[i], you: me,
          sub: me ? "HOST / PEMAIN LOKAL" : state.bot ? "BOT DEMO · ATURAN SAMA DISELOSIR" : "KURSI ILUSTRASI LOKAL",
          status: ready ? { ok: true, label: "✓ SIAP" } : { ok: false, label: "BELUM SIAP" },
        }));
      }
    }

    $("lbPoolBadge").textContent = funded ? "MONAD TESTNET · NO REAL VALUE" : "DEMO LOKAL · TANPA NILAI";
    $("lbFoot").textContent = funded
      ? "Seat yang belum didanai tidak bisa siap. Status funded hanya tampil setelah server memverifikasi receipt deposit."
      : "UI demo: kursi lain dilokal, bukan pemain manusia. Angka hitung mundur 15 detik disimulasikan lokal.";

    const entryWei = state.funded?.entryWei ?? null;
    const entryText = funded
      ? (entryWei !== null ? `${fmtMon(entryWei)} MON (testnet)` : "membaca kontrak…")
      : `${state.credits} KREDITS DEMO`;
    const poolText = funded
      ? (entryWei !== null ? `${fmtMon(entryWei * BigInt(seats))} MON (testnet)` : "—")
      : `${state.credits * state.players} KREDITS DEMO`;
    $("lbEntry").textContent = entryText;
    $("lbPool").textContent = poolText;
    $("lbSeatsN").textContent = String(state.players).padStart(2, "0");
    $("lbDur").textContent = `${(state.players - 1) * 10} DETIK NOMINAL`;
    $("lbNet").textContent = funded ? "MONAD TESTNET · 10143 · ESCROW" : "MONAD TESTNET · 10143";

    const canReady = !funded || allSeatsFunded(roster);
    // The roomKey is the room's on-chain identity: show it, truncated and copyable.
    if (funded) {
      const key = state.funded.roomKey ?? state.netRoom?.roomKey ?? state.netState?.roomKey;
      const row = $("lbKeyRow");
      row?.classList.toggle("hidden", !key);
      if (key) {
        state.roomKey = key;
        $("lbKey").textContent = shortKey(key);
        $("lbKey").title = key;
      }
      // Host deposit link: only with a real hash the server has accepted.
      const dep = state.funded.txHash;
      const url = state.funded.depositConfirmed ? explorerTxUrl(dep) : null;
      const drow = $("lbDepositRow");
      drow?.classList.toggle("hidden", !url);
      if (url) { $("lbDepositLink").href = url; $("lbDepositLink").textContent = `${dep.slice(0, 12)}… ↗`; }
    } else {
      $("lbKeyRow")?.classList.add("hidden");
      $("lbDepositRow")?.classList.add("hidden");
    }
    const btn = $("lbReady");
    if (state.ready) btn.innerHTML = "✓ SIAP! <span>↗</span>";
    else if (!canReady) btn.innerHTML = "MENUNGGU DEPOSIT <span>↗</span>";
    else btn.innerHTML = "SAYA SIAP <span>↗</span>";
    btn.disabled = !canReady;

    // Guest in a funded room who joined over the API but has not deposited yet.
    const joinRow = $("lbJoinRow");
    const needsJoin = funded && localSeatUnfunded();
    joinRow?.classList.toggle("hidden", !needsJoin);
    if (needsJoin) {
      const amt = state.funded?.entryWei ?? null;
      $("lbJoinAmt").textContent = amt !== null ? fmtMon(amt) : "—";
      const jb = $("lbJoin");
      const canJoin = !!w.getAddress() && w.chainId === MONAD_TESTNET.chainId && amt !== null;
      jb.disabled = !canJoin;
      if (!amt) refreshGuestEntryAmount();
    }
  }

  /**
   * A roster seat is "funded" only when the CHAIN says so, read through
   * getRoomDepositors(roomKey) — the same list settlement uses. A wallet without
   * a deposit is not funded; a deposit from a wallet with no seat is flagged
   * rather than counted. No receipt, no badge.
   */
  function roomSeatFunding(p) {
    if (!p?.walletAddress) return { ok: false, cls: "no", label: "UNFUNDED" };
    const onChain = state.depositors;
    if (!Array.isArray(onChain)) {
      // Depositors not read yet (or read failed): do not guess in either direction.
      return { ok: false, cls: "no", label: "MEMBACA CHAIN…" };
    }
    const funded = onChain.some((a) => String(a).toLowerCase() === String(p.walletAddress).toLowerCase());
    if (!funded) return { ok: false, cls: "no", label: "UNFUNDED" };
    return { ok: true, cls: "yes", label: p.kind === "DEMO_BOT" ? "FUNDED · BOT" : "FUNDED" };
  }

  function allSeatsFunded(roster) {
    if (!Array.isArray(roster) || roster.length === 0) return false;
    if (!Array.isArray(state.depositors)) return false;
    return roster.every((p) => roomSeatFunding(p).ok);
  }

  /** Read the on-chain depositor list for the funded lobby. */
  async function refreshDepositors() {
    const key = state.funded?.roomKey ?? state.netRoom?.roomKey ?? state.netState?.roomKey;
    if (!key || !state.escrowAddress) return;
    try {
      const esc = await ensureEscrow();
      if (!esc) return;
      state.depositors = await esc.readDepositors(key);
      renderLobby();
    } catch {
      // Leave the previous list; the seat stays "not funded" rather than
      // flipping to a funded badge on an RPC failure.
    }
  }

  /** True when the local player holds a seat in a funded room with no deposit yet. */
  function localSeatUnfunded() {
    if (!state.funded || state.funded.depositConfirmed) return false;
    const participants = state.netState?.participants;
    if (!Array.isArray(participants)) return true; // joined, roster not received yet
    const me = participants.find((p) => p.participantId === state.netRoom?.participantId);
    // `funded` is set by the server only after it verified the deposit receipt.
    // A bound wallet is not a deposit.
    return !me || !me.funded;
  }
  /** Read this funded room's on-chain entryWei once, for the guest join button. */
  let entryReadAt = 0;
  async function refreshGuestEntryAmount() {
    if (Date.now() < entryReadAt) return;
    entryReadAt = Date.now() + 5000;
    const key = state.funded?.roomKey ?? state.netRoom?.roomKey ?? state.netState?.roomKey;
    if (!key) return;
    const esc = await ensureEscrow();
    if (!esc) return;
    try {
      const room = await esc.readRoom(key);
      if (room?.entryWei) { state.funded.entryWei = room.entryWei; renderLobby(); }
    } catch { /* keep "—"; the button stays disabled rather than guessing an amount */ }
  }

  function startLobbyCountdown() {
    state.ready = true;
    state.lobbyDeadline = Date.now() + 15000;
    state.countdown = true;
    renderLobby();
    toast("Squad siap. Bom mulai dalam 15 detik.");
  }

  // ==== lobby 15 s countdown (drives both countdown tiles + auto start) ====
  // A funded lobby is server-truth: poll the REST room state so deposits made on
  // other laptops appear here without the socket being open yet.
  let lobbyPollAt = 0;
  async function pollFundedLobby() {
    if (!state.funded || state.screen !== "lobby" || !state.netRoom?.roomId) return;
    if (Date.now() < lobbyPollAt) return;
    lobbyPollAt = Date.now() + 3000;
    try {
      const api = createRoomApi({ baseUrl: serverUrl() });
      const res = await api.getRoom(state.netRoom.roomId);
      const room = res?.room ?? res;
      if (room) {
        state.netState = room;
        renderLobby();
      }
      await refreshDepositors();
    } catch { /* transient: keep the last known roster */ }
  }

  function lobbyTick() {
    if (state.screen === "lobby" && state.lobbyDeadline) {
      const left = Math.max(0, state.lobbyDeadline - Date.now()) / 1000;
      $("lbCountTitle").textContent = "ARENA MULAI DALAM";
      $("lbCount").textContent = String(Math.ceil(left)).padStart(2, "0");
      $("lbCountHint").textContent = "kursi terkunci · semua kursi dianggap siap";
      if (left <= 0) { state.lobbyDeadline = 0; state.countdown = false; gateArena(); }
    }
    if (state.screen === "arena") gameTick();
    if (state.screen === "lobby" && state.funded) pollFundedLobby();
    setTimeout(lobbyTick, 100);
  }
  setTimeout(lobbyTick, 100);

  // ==== arena session ====
  // every entry point (ready countdown, SKIP TO MATCH) lands here. An already
  // connected wallet goes straight in; otherwise we try the real wallet module
  // from src/web3/ and fall back to the local demo when there is none, so a
  // walletless practice match still works.
  function gateArena() {
    state.lobbyDeadline = 0;
    state.countdown = false;
    // `const` declarations later in this scope are in the temporal dead zone
    // here, so this must not reference `hasWallet`/`w`. It is only ever called
    // from a click handler or timer, long after module init, but keeping the
    // reference cheap and local avoids a future reorder turning it into a TDZ
    // crash on the first frame.
    if (state.wallet?.getAddress?.()) { enterArena(); return; }
    if (!state.escrowAddress) { enterArena(); return; }
    state.wallet
      .connect()
      .then(() => { walletPill(); enterArena(); })
      .catch(() => {
        // No provider, user cancelled, or wrong chain: do not block the demo.
        toast("Jalan tanpa wallet — mode latihan lokal.");
        enterArena();
      });
  }
  function enterArena() {
    state.ready = false;
    state.lobbyDeadline = 0;
    state.paused = false;
    navigate("arena");
    // Networked path: the server owns the match. Its room REPLACES the local
    // bot room in engine.js, whose loop is kept only as a renderer.
    if (state.net || state.netMode) { startNetworkedArena(); return; }
    ensureGame().newMatch({
      nick: state.nick, seats: state.players, credits: state.credits,
      botNames: AI_NAMES, seatColors: SEAT_COLORS, soundOn: state.soundOn,
      onFinish: (r) => { state.result = r; setTimeout(() => { leaveArena(); navigate("result"); }, 900); },
      toast: (m) => toast(m, true),
    });
    netPill();
  }

  // ---- networked match (server-authoritative; snapshots are the only truth) ----
  async function startNetworkedArena() {
    if (!state.netRoom) {
      // No room yet (SKIP KE MATCH before create): try REST, then fall back.
      const ok = await prepareNetRoom();
      if (!ok) { toast("Server tidak terjangkau — mode lokal."); localArenaFallback(); return; }
    }
    const netToast = (m) => {
      // engine.js renders its own local-pass verdicts; online those are noise
      // (the server sends game:error instead).
      if (/cooldown|Dekati pemain/i.test(m)) return;
      toast(m, true);
    };
    // Connect BEFORE building the renderer: engine.js gets a room only once the
    // server has sent its first authoritative snapshot. The funded guest's
    // entry amount is read by the lobby (refreshGuestEntryAmount), not here.
    state.net = createNetworkedMatch({
      roomId: state.netRoom.roomId,
      sessionToken: state.netRoom.sessionToken,
      participantId: state.netRoom.participantId,
      names: { [state.netRoom.participantId]: state.nick },
    });

    const net = state.net.net;
    net.on("room:state", (s) => {
      state.netState = s;
      netPill();
      // LIVE roster replaces the lobby list; a funded lobby must re-render so an
      // unfunded seat cannot keep a stale "ready" badge.
      if (state.funded) {
        if (s?.roomKey && !state.funded.roomKey) state.funded.roomKey = s.roomKey;
        renderLobby();
      }
      // Server gap: socketAdapter only emits match:finished when winnerId is
      // truthy, so an ABORTED match would never end the client's screen. The
      // terminal room:state is the only signal in that case.
      if (["ABORTED", "CANCELED"].includes(s?.status) && !state.result && state.screen === "arena") {
        toast(`Match ${s.status === "ABORTED" ? "dibatalkan server" : "dibatalkan"} — mode lokal.`, true);
        localArenaFallback();
      }
    });

    net.on("match:started", () => { toast("MATCH DIMULAI — SERVER AUTHORITATIVE", true); netPill(); });
    net.on("match:finished", (f) => {
      const winnerIsLocal = f.winnerId === state.netRoom.participantId;
      const winnerName = winnerIsLocal ? state.nick : "PEMAIN LAIN";
      state.result = {
        seatCount: state.netState?.participants?.length ?? state.players,
        credits: state.credits, winnerName, winnerIsLocal,
        winnerColor: SEAT_COLORS[0],
        // Kept verbatim: null means the server could not compute a commitment,
        // and the result screen says so rather than showing a placeholder.
        resultHash: f.resultHash ?? null,
      };
      if (state.funded?.depositConfirmed && !f.resultHash) {
        toast("Server tidak mengirim resultHash — result not yet recorded on-chain.", true);
      }
      // Do not drop the socket immediately for a funded room: the chain:status
      // events that follow are the only honest source for PENDING → CLAIMABLE →
      // PAID. Give settlement a bounded window, then leave the screen in PENDING.
      if (state.funded?.depositConfirmed) {
        const waitMs = 20000;
        const started = Date.now();
        let done = false;
        const leave = () => {
          if (done) return;
          done = true;
          clearInterval(poll);
          state.net?.dispose(); state.net = null;
          setTimeout(() => navigate("result"), 900);
          netPill();
        };
        const terminal = () => state.chainTerminal === true;
        const poll = setInterval(() => {
          if (terminal() || Date.now() - started > waitMs) leave();
        }, 400);
        // Settlement is usually fast when the chain module is live; check once
        // after the current task so a synchronous CONFIRMED does not wait 400 ms.
        setTimeout(() => { if (terminal()) leave(); }, 0);
      } else {
        state.net.dispose(); state.net = null;
        setTimeout(() => navigate("result"), 900);
      }
      netPill();
    });
    // Chain settlement status — never inferred, only relayed. The raw server
    // vocabulary (SETTLING | CONFIRMED | FAILED) is stored verbatim; the result
    // screen renders those words, not a friendlier synonym.
    net.on("chain:status", (s) => {
      state.chainRecord = {
        state: s.state, // SETTLING | CONFIRMED | FAILED, exactly as sent
        settleTxHash: s.txHash ?? state.chainRecord?.settleTxHash ?? null,
        prizePaidTxHash: s.payoutTxHash ?? null,
        payoutState: s.payoutState ?? null,
        reason: s.reason ?? null,
      };
      // The terminal signal the match:finished handler waits for.
      state.chainTerminal = s.state === "CONFIRMED" || s.state === "FAILED";
      if (s.state === "CONFIRMED") {
        toast(s.payoutState === "PAID" ? "Hadiah dibayar on-chain." : "Settlement CONFIRMED · hadiah bisa diklaim.", true);
      } else if (s.state === "FAILED") {
        toast("Settlement FAILED — belum tercatat on-chain.", true);
      }
    });
    net.on("game:error", (e) => {
      if (e?.code === "PASS_COOLDOWN") toast("Oper masih cooldown.", true);
      else if (e?.code === "NO_PASS_TARGET") toast("Dekati pemain lain ≤1.8 unit untuk oper!", true);
      else if (e?.code === "NOT_BOMB_HOLDER") toast("Kamu tidak memegang bom.", true);
      else if (e?.code === "PROTOCOL_VERSION_MISMATCH") {
        toast("Versi protokol tidak cocok — kembali ke lokal.", true);
        localArenaFallback();
      }
      // BAD_STATE / ALREADY_READY / RATE_LIMITED are expected noise from
      // re-sending ready on reconnect; they must not spam the in-game toast.
      else if (e?.code && !["BAD_STATE", "ALREADY_READY", "RATE_LIMITED"].includes(e.code)) {
        toast(`Server: ${e.code}`, true);
      }
    });
    // Pass ack is the only moment the client may animate a handoff.
    net.on("bomb:pass_accepted", (p) => {
      const a = state.net?.adapter;
      if (!a) return;
      toast(`BOM: ${a.nameOf(p.fromId)} → ${a.nameOf(p.toId)}`, true);
    });
    net.on("disconnected", () => { netPill(); toast("Koneksi putus — menyambung ulang…", true); });
    net.on("connected", () => {
      netPill();
      // Every online client takes its seat as ready: the server starts only
      // when 3+ humans are ready, so this cannot fake a match on its own.
      // Re-sent after a reconnect because the server re-seats via subscribe.
      net.setReady(true);
    });
    if (net.isConnected) net.setReady(true);
    netPill();

    // The server only broadcasts snapshots once the room is LIVE and all seats
    // are ready, so we wait for real state instead of simulating. The renderer
    // is built only after the first snapshot: a networked arena never shows a
    // locally invented match, not even for one frame.
    toast("Menunggu pemain lain siap…", true);
    const ready = await waitForSnapshot(state.net.adapter, 45_000);
    if (!ready) {
      const status = state.netState?.status ?? "WAITING";
      toast(`Server belum memulai (${status}) — mode lokal.`);
      localArenaFallback();
      return;
    }

    const api = ensureGame();
    api.newMatch({
      // Seat count comes from the server roster, not the local create form.
      nick: state.nick, seats: Math.max(3, state.net.adapter.seatCount || state.players),
      credits: state.credits, botNames: AI_NAMES, seatColors: SEAT_COLORS, soundOn: state.soundOn,
      onFinish: () => {}, // finish is decided by match:finished, not the sim
      toast: netToast,
    });
    state.net.bindEngine(api);
  }

  /** Resolve true as soon as the adapter holds a server snapshot. */
  function waitForSnapshot(adapter, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (adapter.hasSnapshot) { clearInterval(iv); resolve(true); }
        else if (Date.now() - started > timeoutMs) { clearInterval(iv); resolve(false); }
      }, 50);
    });
  }

  function localArenaFallback() {
    state.net?.dispose(); state.net = null;
    const api = ensureGame();
    api.newMatch({
      nick: state.nick, seats: state.players, credits: state.credits,
      botNames: AI_NAMES, seatColors: SEAT_COLORS, soundOn: state.soundOn,
      onFinish: (r) => { state.result = r; setTimeout(() => navigate("result"), 900); },
      toast: (m) => toast(m, true),
    });
    netPill();
  }

  // ==== wallet + funded room (P0/P1) =====================================
  // The funded path is additive. If any part is missing (no provider, no escrow
  // address, wrong chain, server unreachable) the app keeps the local demo and
  // says why in the banner. It never blocks the demo on a wallet.
  const w = state.wallet;
  const hasWallet = () => !!state.escrowAddress;

  function walletPill() {
    const label = $("walletLabel");
    const badge = $("chainBadge");
    const btn = $("walletBtn");
    if (!label) return;
    const addr = w.getAddress();
    const chainOk = w.chainId === MONAD_TESTNET.chainId;
    if (addr) {
      label.textContent = `${truncateAddress(addr)}${chainOk ? "" : " ⚠"}`;
      btn?.classList.toggle("ok", chainOk);
      btn?.classList.toggle("bad", !chainOk);
      badge.hidden = false;
      badge.textContent = w.chainId ? `${w.chainId} · MONAD TESTNET` : "CHAIN ?";
      badge.classList.toggle("bad", !chainOk);
    } else {
      label.textContent = w.isAvailable ? "HUBUNGKAN WALLET" : "TANPA WALLET";
      btn?.classList.remove("ok", "bad");
      badge.hidden = true;
    }
    renderChainBanner();
    refreshFunded();
  }

  let bannerDismissed = false;
  function renderChainBanner() {
    const el = $("chainBanner");
    if (!el) return;
    const addr = w.getAddress();
    let show = false, title = "", body = "", action = true;
    if (addr && w.chainId && w.chainId !== MONAD_TESTNET.chainId) {
      show = true;
      title = "JARINGAN SALAH";
      body = `Wallet di chain ${w.chainId}. MONAD TESTNET (10143) diperlukan untuk deposit.`;
    } else if (addr && !w.chainId) {
      show = true; title = "CHAIN TIDAK TERBACA";
      body = "Tidak bisa membaca eth_chainId. Deposit diblokir.";
    } else if (!w.isAvailable && hasWallet()) {
      show = true; title = "TANPA WALLET";
      body = "Tidak ada provider EIP-1193 (window.ethereum). Pasang wallet Monad, atau mainkan demo lokal tanpa deposit.";
    }
    el.hidden = !show || bannerDismissed;
    if (show) {
      $("chainBannerTitle").textContent = title;
      $("chainBannerBody").textContent = body;
      const act = el.querySelector("[data-action='wallet-switch']");
      if (act) act.hidden = !action;
    }
  }

  async function connectWallet() {
    const res = await w.connect();
    walletPill();
    if (!res.ok) {
      if (res.error === "NO_WALLET") {
        toast("Tidak ada wallet. Demo lokal tetap tersedia.");
      } else {
        toast(friendlyWalletError({ message: res.error, code: res.code }));
      }
      return;
    }
    // Connected: offer the chain switch right away, but never auto-force it —
    // the user sees the banner and decides.
    const chain = await w.ensureChain();
    walletPill();
    if (!chain.ok) {
      toast("Chain belum 10143 — deposit terkunci.");
    } else {
      toast("Wallet terhubung · Monad Testnet 10143");
    }
    await loadBounds();
  }

  async function ensureEscrow() {
    if (!state.escrowAddress) return null;
    if (state.escrow) return state.escrow;
    state.escrow = createEscrow({ wallet: w, escrowAddress: state.escrowAddress });
    return state.escrow;
  }

  async function loadBounds() {
    const box = $("fundedBox");
    if (!box) return;
    if (!state.escrowAddress) { box.hidden = true; return; }
    box.hidden = false;
    $("fdWallet").textContent = w.getAddress() ? truncateAddress(w.getAddress()) : "belum terhubung";
    $("fdEscrow").textContent = state.escrowAddress;
    const esc = await ensureEscrow();
    if (!esc) { $("fdBounds").textContent = "escrow tidak tersedia"; return; }
    try {
      state.bounds = await esc.readBounds();
      $("fdBounds").textContent = `${fmtMon(state.bounds.minWei)} – ${fmtMon(state.bounds.maxWei)} MON`;
      // Pre-select the preset closest to the contract minimum, and only keep it
      // if it actually falls inside the bounds read from the chain.
      // Only presets the SERVER also accepts can create a funded room today
      // (see SERVER_MIN_ENTRY_WEI). Default to 0.01 MON when it is in bounds.
      const presets = [10n ** 16n, 5n * 10n ** 15n, 10n ** 15n];
      const pick = presets.find((p) => p >= state.bounds.minWei && p <= state.bounds.maxWei) ?? state.bounds.minWei;
      setEntryWei(pick);
    } catch (err) {
      state.bounds = null;
      $("fdBounds").textContent = "GAGAL MEMBACA KONTRAK";
      $("fdErr").textContent = `entryBounds() gagal: ${err.message}. Deposit diblokir.`;
      setEntryWei(null);
    }
    refreshFunded();
  }

  function setEntryWei(wei) {
    state.entryWei = wei === null ? null : BigInt(wei);
    const input = $("fdWei");
    if (input) input.value = state.entryWei === null ? "" : String(state.entryWei);
    document.querySelectorAll("[data-mono]").forEach((b) => {
      const v = BigInt(Math.round(Number(b.dataset.mono) * 1e6)) * 10n ** 12n; // 0.001 MON → 1e15
      b.classList.toggle("sel", state.entryWei !== null && v === state.entryWei);
    });
    const pool = $("fdPool");
    if (pool) pool.textContent = state.entryWei === null ? "—" : `${fmtMon(state.entryWei * BigInt(state.players))} MON`;
    refreshFunded();
  }

  /** The deposit button is enabled only when every hard precondition holds. */
  function refreshFunded() {
    const btn = $("fdCreate");
    if (!btn) return;
    const addr = w.getAddress();
    const chainOk = w.chainId === MONAD_TESTNET.chainId;
    const boundsOk = !!state.bounds && state.entryWei !== null
      && state.entryWei >= state.bounds.minWei && state.entryWei <= state.bounds.maxWei;
    const serverOk = state.entryWei !== null && state.entryWei >= SERVER_MIN_ENTRY_WEI;
    const ok = !!addr && chainOk && boundsOk && serverOk && !!state.escrowAddress && !state.creating;
    btn.disabled = !ok;
    const err = $("fdErr");
    if (!err) return;
    if (state.creating) err.textContent = "";
    else if (!state.escrowAddress) err.textContent = "Escrow belum dikonfigurasi (?escrow=0x…).";
    else if (!addr) err.textContent = "Hubungkan wallet untuk membuat room berdana.";
    else if (!chainOk) err.textContent = `Wallet di chain ${w.chainId ?? "?"} — pindah ke 10143 dulu.`;
    else if (!boundsOk) err.textContent = "Nominal di luar batas kontrak.";
    else if (!serverOk) err.textContent = "Server hanya menerima 0.01 MON untuk room berdana saat ini (batas demo-credit 1e16 wei).";
    else err.textContent = "";
  }

  // The server's demo-credit field is 1e16..1e19 wei AND must equal the chain
  // entryWei (store.ts), while the contract's window is 1e15..1e16. The overlap
  // is exactly 0.01 MON, so that is the only entry a FUNDED room can use today.
  // Stated in the UI rather than discovered as a server error at demo time.
  const SERVER_MIN_ENTRY_WEI = 10n ** 16n;

  async function createFundedRoom() {
    if (state.creating) return;
    refreshFunded();
    const btn = $("fdCreate");
    if (btn?.disabled) return;
    const addr = w.getAddress();
    if (!addr) { toast("Hubungkan wallet dulu."); return; }
    if (w.chainId !== MONAD_TESTNET.chainId) { toast("Chain salah — deposit diblokir."); renderChainBanner(); return; }

    state.creating = true;
    refreshFunded();
    const prevLabel = btn.innerHTML;
    btn.innerHTML = "MENUNGGU WALLET… <span>↗</span>";
    try {
      const esc = await ensureEscrow();
      const amount = state.entryWei;
      if (!(await serverReachable(serverUrl()))) throw new Error("SERVER_UNREACHABLE");

      // 1. The HOST generates the roomKey in the browser. It is the room's
      //    on-chain identity and must exist before the first deposit, so it is
      //    built here, not derived by the server afterwards.
      const { roomKey } = esc.makeRoomKey(addr);

      // 2. Deadlines in UNIX SECONDS (contract uint64), computed browser-side.
      //    The contract caps each window at creation time, so the value sent is
      //    min(intended window, cap - 60s). With the deployed caps that is
      //    540 / 1140, NOT the 600 / 1200 named in the spec — the spec's numbers
      //    are the caps, and the 60s slack exists because block.timestamp runs
      //    ahead of the browser clock and the contract rejects a deadline past
      //    `nowTs + cap`.
      const windows = await esc.readWindows();
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      // Leave a minute of slack under each contract cap: block.timestamp is
      // always ahead of the browser clock, and the contract rejects a deadline
      // beyond `nowTs + cap`.
      const fundingCap = windows.maxFundingWindowSec > 60n ? windows.maxFundingWindowSec - 60n : windows.maxFundingWindowSec;
      const resolutionCap = windows.maxResolutionWindowSec > 60n ? windows.maxResolutionWindowSec - 60n : windows.maxResolutionWindowSec;
      const fundingDeadline = nowSec + (540n < fundingCap ? 540n : fundingCap);
      let resolutionDeadline = nowSec + (1140n < resolutionCap ? 1140n : resolutionCap);
      if (resolutionDeadline <= fundingDeadline) resolutionDeadline = fundingDeadline + 60n;

      // 3. createRoom + the host's own deposit, one transaction. The provider
      //    shows the exact wei; nothing is pre-signed or estimated.
      const sent = await esc.createRoom({
        roomKey, seats: state.players, entryWei: amount,
        fundingDeadline, resolutionDeadline,
      });

      // 4. Tell the server which roomKey this game room is. The server VERIFIES
      //    it on chain (exists, host matches, entry matches) before binding it.
      btn.innerHTML = "MENDAFTARKAN ROOM… <span>↗</span>";
      const api = createRoomApi({ baseUrl: serverUrl() });
      let created;
      try {
        created = await api.createRoom({
          virtualDemoEntryWei: String(amount),
          allowDemoBot: state.bot,
          visibility: "PUBLIC",
          hostWalletAddress: addr,
          roomKey,
        });
      } catch (err) {
        // The chain deposit already happened. Never hide that: keep the roomKey
        // on screen so the funds are recoverable, and say exactly what failed.
        state.funded = { txHash: sent.txHash, entryWei: amount, roomKey, depositConfirmed: false, error: String(err.message || err) };
        $("fdErr").textContent = `Deposit terkirim (${roomKey.slice(0, 10)}…) tetapi server menolak room: ${err.code || err.message}`;
        toast("Deposit on-chain ada, room server gagal. roomKey disimpan di layar.");
        return;
      }
      state.netRoom = {
        roomId: created.roomId, code: created.code, participantId: created.participantId,
        sessionToken: created.sessionToken, isHost: true, roomKey,
      };
      state.code = created.code || state.code;
      state.netMode = true;

      // 5. Receipt verification. The server re-reads the chain; a hash alone is
      //    never treated as proof, and `confirmed` is the only thing that turns
      //    the badge on.
      btn.innerHTML = "VERIFIKASI RECEIPT… <span>↗</span>";
      let confirmed = false;
      try {
        const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(created.roomId)}/deposit-confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: sent.txHash, walletAddress: addr }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.confirmed) throw new Error(body.error || body.message || `HTTP_${res.status}`);
        confirmed = true;
        if (body.room) state.netState = body.room;
      } catch (err) {
        state.funded = { txHash: sent.txHash, entryWei: amount, roomKey, depositConfirmed: false, error: String(err.message || err) };
        toast("Deposit terkirim tetapi BELUM terverifikasi server.");
        navigate("lobby");
        return;
      }

      state.funded = { txHash: sent.txHash, entryWei: amount, roomKey, depositConfirmed: confirmed };
      // The HUD's credit number is cosmetic; chain wei above is authoritative.
      state.credits = Number(amount / 10n ** 14n);
      toast("Room berdana dibuat · deposit terverifikasi.");
      navigate("lobby");
    } catch (err) {
      const msg = err?.code === "CHAIN_MISMATCH" ? "Chain berubah — deposit dibatalkan."
        : err?.message === "SERVER_UNREACHABLE" ? "Server tidak terjangkau — tidak ada dana terkirim."
        : friendlyWalletError(err);
      $("fdErr").textContent = msg;
      toast(msg);
    } finally {
      state.creating = false;
      btn.innerHTML = prevLabel;
      refreshFunded();
      walletPill();
    }
  }

  // Wallet events keep the top bar and the deposit gate honest live.
  w.onAccountChange(() => { walletPill(); });
  w.onChainChange(() => { walletPill(); });

  // Create-or-join over the ACTUAL REST routes.  //  - host: POST /api/rooms (server joins the host immediately)
  //  - guest: ?net=1&room=<roomId> → POST /api/rooms/:roomId/join
  // The server requires 3+ ready humans to start, so this cannot fake a match.
  async function prepareNetRoom() {
    if (state.netRoom) return true;
    if (!(await serverReachable(serverUrl()))) return false;
    const api = createRoomApi({ baseUrl: serverUrl() });
    const params = new URLSearchParams(location.search);
    const joinId = params.get("room");
    // ?name= lets extra demo laptops identify themselves (REST has no display
    // name field — the server roster carries ids + kind only).
    const name = params.get("name");
    if (name) state.nick = name.slice(0, 16);
    try {
      if (joinId) {
        // Bind the wallet when there is one, so a funded guest seat can be
        // verified later. A walletless demo join is unchanged.
        const res = await api.joinRoom(joinId, "HUMAN", w.getAddress() || null);
        state.netRoom = { roomId: joinId, code: res.room?.code ?? "", participantId: res.participantId, sessionToken: res.sessionToken, isHost: false };
        state.code = res.room?.code || state.code;
        // A funded room the guest has not deposited into yet: carry the server's
        // roomKey so the lobby can offer joinRoom() with the contract's amount.
        //
        // The seat carries a wallet because joinRoom bound it a moment ago. The
        // question is not "does the seat have a wallet" but "has this seat's
        // deposit been confirmed on chain". Reading it the other way inverted
        // the gate and hid the join button from every connected guest.
        const roomKey = res.room?.roomKey ?? null;
        const me = (res.room?.participants || []).find((p) => p.participantId === res.participantId);
        const alreadyFunded = Boolean(me?.funded);
        if (state.escrowAddress && roomKey && me && !alreadyFunded) {
          state.funded = { txHash: null, entryWei: null, roomKey, depositConfirmed: false };
          state.netMode = true;
        }
        return true;
      }
      // Credit presets (1..1000) → virtualDemoEntryWei inside the server's 1e16..1e19 window.
      const wei = (BigInt(Math.max(1, Math.min(1000, state.credits))) * 10n ** 16n).toString();
      const res = await api.createRoom({ virtualDemoEntryWei: wei, allowDemoBot: state.bot, visibility: "PUBLIC" });
      state.netRoom = { roomId: res.roomId, code: res.code, participantId: res.participantId, sessionToken: res.sessionToken, isHost: true };
      state.code = res.code || state.code;
      return true;
    } catch (err) {
      console.warn("[net] room setup failed", err);
      toast(`Server menolak room (${err.code || "ERROR"}) — mode lokal.`);
      state.netRoom = null;
      return false;
    }
  }

  function leaveArena() {
    state.paused = true;
    if (state.net) { state.net.dispose(); state.net = null; }
    ensureGame().dispose(); boot3d = null;
    netPill();
  }
  function pauseGame() {
    if (state.screen !== "arena" || boot3d?.room?.over) return;
    state.paused = true;
    $("oPause").classList.remove("hidden");
  }
  function resumeGame() { $("oPause").classList.add("hidden"); state.paused = false; }
  on("btnSound", "click", () => {
    state.soundOn = !state.soundOn;
    $("btnSound").textContent = state.soundOn ? "🔊" : "🔇";
    if (menuSfx) menuSfx.on = state.soundOn;
    menuMusic(MENU_SCREENS.includes(state.screen));
    ensureGame().setSound(state.soundOn);
  });

  // gameTick — HUD refresh every ~100 ms between renders (numbers only; 3D keeps its own 60 fps loop)
  function gameTick() {
    const api = boot3d;
    if (!api || state.paused) return;
    api.hudSync();
  }

  // keyboard: pass (E) + ESC pause
  addEventListener("keydown", (e) => {
    if (state.screen !== "arena" || e.target.closest("input,textarea")) return;
    if (e.code === "KeyE" && !e.repeat) {
      // Online: send the intent only; the server picks/validates the target.
      if (state.net) state.net.pass(); else ensureGame().pressPass();
    }
    if (e.code === "Escape" && !e.repeat) { state.paused ? resumeGame() : pauseGame(); }
  });

  // ==== result screen ====
  function renderResult() {
    const r = state.result;
    if (!r) return navigate("home");
    const win = r.winnerName || state.nick;
    const isMe = r.winnerIsLocal;
    $("rHead").innerHTML = isMe ? 'KAMU <span class="orange">BERTAHAN.</span>' : "TERAKHIR <span>BERTAHAN.</span>";
    $("rSub").textContent = isMe ? "Kamu menghindari setiap ledakan. Squad-mu tak punya waktu." : "Arena memilih penyintasnya. Siap balas dendam?";
    $("rAva").textContent = win[0];
    $("rAva").style.background = r.winnerColor || "#ac90e8";
    $("rName").textContent = win;
    $("rDesc").textContent = isMe ? "KAMU BERTAHAN DARI KEKACAUAN" : "JUARA MATCH LOKAL INI";
    $("rMode").textContent = `${r.seatCount}-PLAYER SURVIVAL`;

    // `funded` means escrow-backed, not necessarily deposit-verified for THIS
    // wallet. The pool line only claims MON when the receipt was confirmed.
    const funded = !!state.funded;
    const verified = !!state.funded?.depositConfirmed;
    // Print a MON figure ONLY when it is actually MON. The demo-credit path used
    // to write an integer here while the unit line underneath said "MON", so a
    // 100-credit room read as a 300 MON pot.
    $("rPool").textContent = verified
      ? fmtMon(state.funded.entryWei * BigInt(r.seatCount))
      : String(r.credits * r.seatCount);
    $("rPoolUnit").textContent = verified
      ? `${fmtMon(state.funded.entryWei * BigInt(r.seatCount))} MON TESTNET · NO REAL VALUE`
      : funded ? "ROOM BERDANA · DEPOSIT BELUM TERVERIFIKASI"
      : "KREDITS DEMO · TANPA NILAI";
    renderResultChain(funded);
  }

  /**
   * Chain state is rendered from what the server actually told us, in the
   * server's own words:
   *   PENDING   (no chain:status yet, or SETTLING) — nothing recorded
   *   CONFIRMED — settlement receipt verified; the prize may still be unpaid
   *   FAILED    — the attempt failed; funds stay in escrow
   * An explorer link appears only when the matching hash is a real 32-byte hash.
   * There is no path here that prints "PAID" without a payout receipt.
   */
  function renderResultChain(funded) {
    const box = $("rChainBox");
    const rec = state.chainRecord;
    const proj = settlementState({ chainRecord: rec ?? {} });
    const steps = document.querySelectorAll("#rChainBox .cstep");

    if (!funded) {
      box.hidden = true;
      $("rChain").textContent = "BELUM DICATAT";
      $("rChainSub").textContent = "TANPA BACKEND — STATUS JUJUR";
      return;
    }

    box.hidden = false;
    const raw = rec?.state ?? null;
    const failed = raw === "FAILED";
    const confirmed = raw === "CONFIRMED";
    const settling = raw === "SETTLING";

    steps.forEach((el) => {
      const i = ["PENDING", "CLAIMABLE", "PAID"].indexOf(el.dataset.step);
      el.className = "cstep";
      if (failed) { if (i === 0) el.classList.add("fail"); return; }
      if (i === 0) el.classList.add(confirmed || settling ? "done" : "on");
      else if (i === 1) { if (confirmed) el.classList.add("done"); else if (settling) el.classList.add("on"); }
      else if (i === 2) { if (proj.payoutTxHash) el.classList.add("done"); }
    });

    const links = [];
    const settleUrl = explorerTxUrl(proj.settleTxHash);
    const payoutUrl = explorerTxUrl(proj.payoutTxHash);
    // A missing resultHash is a separate fact from a missing settlement: the
    // server could not commit a result at all. Say that, never invent a hash.
    if (!state.result?.resultHash) {
      links.push(`<span>Result not yet recorded on-chain (server mengirim resultHash: null).</span>`);
    } else {
      links.push(`<span>resultHash: ${escapeHTML(shortKey(state.result.resultHash))}</span>`);
    }
    if (!raw) links.push(`<span>Belum ada settlement.</span>`);
    if (settling) links.push(`<span>SETTLING — menunggu receipt settlement.</span>`);
    if (settleUrl) links.push(`<a href="${settleUrl}" target="_blank" rel="noopener noreferrer">SETTLE TX · ${proj.settleTxHash.slice(0, 12)}… ↗</a>`);
    if (payoutUrl) links.push(`<a href="${payoutUrl}" target="_blank" rel="noopener noreferrer">PAYOUT TX · ${proj.payoutTxHash.slice(0, 12)}… ↗</a>`);
    if (confirmed && !payoutUrl) links.push(`<span>Hadiah tercatat dan bisa diklaim; PrizePaid belum diterima.</span>`);
    if (failed && rec?.reason) links.push(`<span>Penyebab: ${escapeHTML(String(rec.reason)).slice(0, 200)}</span>`);
    $("rTxLinks").innerHTML = links.join("");

    // The headline word is the settlement state AFTER the downgrade, not the raw
    // server string. A `CONFIRMED` badge with no settle tx hash means the server
    // asserted a settlement it never proved, and printing "TERVERIFIKASI"
    // underneath would be a claim the evidence does not support.
    $("rChain").textContent = failed ? "FAILED" : confirmed ? "CONFIRMED" : settling ? "SETTLING" : "PENDING";
    $("rChainSub").textContent = failed
      ? "NOT YET RECORDED ON-CHAIN — DANA TETAP DI ESCROW"
      : (confirmed && proj.settleTxHash)
        ? (proj.payoutTxHash ? "SETTLEMENT + PAYOUT TERVERIFIKASI" : "SETTLEMENT TERVERIFIKASI · BELUM DIBAYAR")
        : confirmed
          ? "STATUS DITERIMA TANPA RECEIPT — BELUM TERVERIFIKASI"
          : "MENUNGGU SETTLEMENT";
    $("rChainNote").textContent = proj.mismatch
      ? "Server mengirim status tanpa receipt pendukung; UI menurunkannya ke status yang benar-benar terbukti."
      : "Status hanya berubah dari event chain:status server. Hasil game tidak pernah dianggap sebagai pembayaran.";
  }

  // ==== actions registry (same data-action dispatch as the reference) ====
  const ACTIONS = {
    home: () => { navigate("home"); $("modal").classList.add("hidden"); },
    how: () => $("modal").classList.remove("hidden"),
    "close-modal": () => $("modal").classList.add("hidden"),
    create: () => { refreshCreate(); navigate("create"); },
    "wallet-connect": async () => {
      if (w.getAddress()) {
        // Already connected: this button becomes the chain-fix / disconnect menu.
        if (w.chainId !== MONAD_TESTNET.chainId) {
          const res = await w.ensureChain();
          walletPill();
          if (!res.ok) toast(res.error || "Gagal pindah chain.");
          else { toast("Chain Monad Testnet aktif."); await loadBounds(); }
          return;
        }
        w.disconnect();
        walletPill();
        toast("Wallet dilepas dari sesi ini.");
        return;
      }
      await connectWallet();
    },
    "wallet-switch": async () => {
      bannerDismissed = false;
      const res = await w.ensureChain();
      walletPill();
      if (!res.ok) toast(res.error || "Gagal pindah chain.");
      else { toast("Chain Monad Testnet aktif."); await loadBounds(); }
    },
    "banner-dismiss": () => { bannerDismissed = true; renderChainBanner(); },
    "funded-create": () => createFundedRoom(),

    /**
     * Guest seat in a funded room: POST join (binding the wallet), then
     * joinRoom() on the contract with the room's own entryWei, then
     * deposit-confirm. Same receipt gate as the host.
     */
    "join-deposit": async () => {
      const roomId = state.netRoom?.roomId;
      if (!roomId) { toast("Room tidak dikenal."); return; }
      const addr = w.getAddress();
      if (!addr) { toast("Hubungkan wallet dulu."); return; }
      if (w.chainId !== MONAD_TESTNET.chainId) { toast("Chain salah — deposit diblokir."); renderChainBanner(); return; }
      const jb = $("lbJoin");
      const prev = jb.innerHTML;
      jb.disabled = true;
      jb.innerHTML = "MENUNGGU WALLET… <span>↗</span>";
      try {
        const api = createRoomApi({ baseUrl: serverUrl() });
        const room = await api.getRoom(roomId);
        const info = room?.room ?? room;
        const roomKey = info?.roomKey;
        if (!roomKey) throw new Error("ROOM_KEY_MISSING");

        // The amount to send is the CONTRACT's entryWei for this room — not the
        // server's demo-credit field, which lives in a different range.
        const esc = await ensureEscrow();
        const onChain = await esc.readRoom(roomKey);
        const entryWei = onChain.entryWei;
        if (!entryWei || entryWei <= 0n) throw new Error("ENTRY_MISSING");

        // The seat was already bound to this wallet by prepareNetRoom's join
        // call. Do not join again: the server would mint a second participant
        // and the deposit would no longer match the seat it verified.
        const sent = await esc.joinRoom(roomKey, entryWei);
        jb.innerHTML = "VERIFIKASI RECEIPT… <span>↗</span>";
        const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(roomId)}/deposit-confirm`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: sent.txHash, walletAddress: addr }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.confirmed) throw new Error(body.error || `HTTP_${res.status}`);
        state.funded = { ...(state.funded || {}), txHash: sent.txHash, entryWei, roomKey, depositConfirmed: true };
        if (body.room) state.netState = body.room;
        toast("Deposit terverifikasi · kursi didanai.");
        await refreshDepositors();
        renderLobby();
      } catch (err) {
        const msg = err.message === "ROOM_KEY_MISSING" ? "Server tidak memberi roomKey untuk room ini."
          : err.message === "ENTRY_MISSING" ? "Entry room tidak terbaca."
          : friendlyWalletError(err);
        toast(msg);
      } finally {
        jb.innerHTML = prev;
        renderLobby();
      }
    },

    "confirm-create": () => {
      const nick = readName();
      if (nick.length < 2) { $("fErr").textContent = "Nickname minimal 2 karakter."; return; }
      state.nick = nick;
      // A funded room already has its code + roomId from the server. Keep them;
      // otherwise this is the local demo and a fake code is fine.
      if (!state.funded?.depositConfirmed) state.code = newCode();
      state.ready = false; state.lobbyDeadline = 0; state.countdown = false;
      navigate("lobby");
    },
    "toggle-ready": () => {
      if (state.funded?.depositConfirmed) {
        const roster = state.netState?.participants;
        if (!allSeatsFunded(roster)) { toast("Masih ada kursi yang belum didanai."); return; }
      }
      if (state.ready) { state.ready = false; state.lobbyDeadline = 0; state.countdown = false; renderLobby(); toast("Siap dibatalkan."); }
      else startLobbyCountdown();
    },
    start: () => { state.lobbyDeadline = 0; state.countdown = false; enterArena(); }, // "SKIP KE MATCH"
    "copy-roomkey": () => {
      const key = state.roomKey ?? state.funded?.roomKey;
      if (!key) { toast("Belum ada roomKey."); return; }
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(key).then(() => toast("roomKey disalin."), () => toast(key));
      else toast(key);
    },
    "copy-code": () => {
      // A funded networked room is joined by roomId, not by the 6-char code:
      // the server has no route keyed on the code. Handing a guest the code
      // gave them a string the app could not resolve, so share the link that
      // actually binds a seat.
      const roomId = state.netRoom?.roomId;
      const isLink = state.netMode && roomId;
      const val = isLink
        ? `${location.origin}${location.pathname}?net=1&room=${encodeURIComponent(roomId)}`
        : state.code;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(val).then(
          () => toast(isLink ? "Link undangan disalin" : "Kode disalin: " + val),
          () => toast(isLink ? val : "Kode: " + val),
        );
      } else toast(isLink ? val : "Kode: " + val);
    },
    lobby: () => { leaveArena(); navigate("lobby"); state.paused = false; },
    pause: () => pauseGame(),
    resume: () => resumeGame(),
    sound: () => on("btnSound", "click"),
    rematch: () => { state.ready = false; state.lobbyDeadline = 0; navigate("lobby"); },
  };
  function processAction(a) { ACTIONS[a]?.(); }

  // boot
  refreshCreate();
  netPill();
  walletPill();
  if (hasWallet()) {
    // Restore silently (no prompt): a returning demo laptop should show its
    // address and chain without another wallet popup.
    w.restore().then(() => { walletPill(); });
  }
  // Touch pass button is wired inside engine.js to the local sim; in network
  // mode intercept it first so it becomes a server intent.
  document.addEventListener("pointerdown", (e) => {
    if (!state.net || !e.target.closest?.("#tPass")) return;
    e.preventDefault();
    e.stopPropagation();
    state.net.pass();
  }, true);
  const hash = location.hash || "/";
  const initial = hash === "/rooms/create" ? "create" : hash.startsWith("/room/") ? "lobby" : "home";
  if (initial === "lobby") { state.code = decodeURIComponent(hash.split("/")[2] || state.code); }
  navigate(initial);
})();

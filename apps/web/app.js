// BOMB RUSH — single-page flow adapted from reference/BOMB_RUSH_Frontend (screens:
// home → create → lobby → arena → result + how-to-play modal + toasts + touch HUD),
// but gameplay runs on the project's own authoritative sim (src/game/sim.js) rendered
// through the project's own 3D assets (src/assets/*). No Canvas-2.5D renderer here.
import { bootMatch } from "./src/game/engine.js";
import { bootLobbyPreview } from "./src/game/lobbyPreview.js";
import { SFX } from "./src/game/sfx.js";
import { makeRoom, addPlayer, startRound, step, pass, input, PASS_RANGE } from "./src/game/sim.js";

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
  };

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
    if (next === "lobby") renderLobby();
    if (next === "result") renderResult();
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
    if (bot) { state.bot = bot.dataset.bot === "fun"; refreshCreate(); }
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

  // ==== wallet gate — EIP-1193 directly, Monad Testnet only. No SDK, no signing:
  // this demo never moves funds, it only proves the chain can be reached. ====
  const MONAD_TESTNET = {
    chainId: "0x279f", // 10143
    chainName: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: ["https://testnet-rpc.monad.xyz"],
    blockExplorerUrls: ["https://testnet.monadscan.com"],
  };
  const wallet = { addr: null, chain: null };
  function walletUi(msg, err = "") {
    $("wStatus").textContent = wallet.addr ? "TERHUBUNG · TESTNET" : "BELUM TERHUBUNG";
    $("wAddr").textContent = wallet.addr ? wallet.addr.slice(0, 6) + "…" + wallet.addr.slice(-4) : "—";
    $("wErr").textContent = err;
    if (msg) toast(msg);
  }
  async function walletConnect() {
    const eth = window.ethereum;
    if (!eth) { walletUi("", "Wallet tidak terdeteksi. Pasang MetaMask atau lanjut tanpa wallet."); return false; }
    try {
      const [addr] = await eth.request({ method: "eth_requestAccounts" });
      wallet.addr = addr;
      const chain = await eth.request({ method: "eth_chainId" });
      if (chain !== MONAD_TESTNET.chainId) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_TESTNET.chainId }] });
        } catch (e) {
          if (e?.code !== 4902) throw e; // 4902 = chain unknown → offer to add it
          await eth.request({ method: "wallet_addEthereumChain", params: [MONAD_TESTNET] });
        }
      }
      wallet.chain = MONAD_TESTNET.chainId;
      walletUi("Wallet terhubung ke Monad Testnet.", "");
      return true;
    } catch (e) {
      walletUi("", e?.code === 4001 ? "Permintaan wallet dibatalkan." : "Gagal connect: " + (e?.message || "unknown"));
      return false;
    }
  }
  function openWallet() { walletUi("", ""); $("walletModal").classList.remove("hidden"); }
  function closeWallet() { $("walletModal").classList.add("hidden"); }

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

  // ==== bet form on the local player's seat row (demo only: no tx, no signing) ====
  document.addEventListener("input", (e) => {
    if (e.target.id === "betAmt") state.betInput = e.target.value;
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "betForm") return;
    e.preventDefault();
    const raw = $("betAmt").value.trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n <= 0) { toast("Isi nominal MON lebih dari 0."); return; }
    state.bet = +n.toFixed(2);
    state.betInput = String(state.bet);
    renderLobby();
    toast(`Bet ${state.bet} MON dicatat. Menunggu backend mengirim tx.`);
  });

  // ==== lobby seat list (same render as reference, honest local-mock labels) ====
  function escapeHTML(x) { return String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }
  function renderLobby() {
    $("lbCode").textContent = state.code;
    $("lbOcc").textContent = String(state.players).padStart(2, "0") + " / " + String(state.players).padStart(2, "0");
    const list = $("lbSeats");
    list.innerHTML = "";
    for (let i = 0; i < state.players; i++) {
      const me = i === 0;
      const name = me ? state.nick : AI_NAMES[i - 1];
      const ready = me ? state.ready : true;
      list.insertAdjacentHTML("beforeend", `<div class="seat${me ? " you" : ""}">
        <i style="--sc:${SEAT_COLORS[i]}">${escapeHTML(name[0])}</i>
        <div><b>${escapeHTML(name)}${me ? " (KAMU)" : ""}</b><small>${me ? "HOST / PEMAIN LOKAL" : state.bot ? "BOT DEMO · ATURAN SAMA DISELOSIR" : "KURSI ILLUSTRASI LOKAL"}</small></div>
        ${me ? `<form class="betrow" id="betForm">
          <input id="betAmt" type="number" min="0" step="any" inputmode="decimal" placeholder="MON" value="${escapeHTML(state.betInput)}" aria-label="Nominal bet MON" />
          <button type="submit" class="betbtn">BET</button>
          ${state.bet ? `<small class="betst">BET ${state.bet} MON · MENUNGGU TX</small>` : ""}
        </form>` : ""}
        <small class="st${ready ? "" : " wait"}">${ready ? "✓ SIAP" : "BELUM SIAP"}</small>
      </div>`);
    }
    $("lbReady").innerHTML = state.ready ? "✓ SIAP! <span>↗</span>" : "SAYA SIAP <span>↗</span>";
    $("lbEntry").textContent = `${state.credits} KREDIT DEMO`;
    $("lbPool").textContent = `${state.credits * state.players} KREDIT DEMO`;
    $("lbSeatsN").textContent = String(state.players).padStart(2, "0");
    $("lbDur").textContent = `${(state.players - 1) * 10} DETIK NOMINAL`;
  }
  function startLobbyCountdown() {
    state.ready = true;
    state.lobbyDeadline = Date.now() + 15000;
    state.countdown = true;
    renderLobby();
    toast("Squad siap. Bom mulai dalam 15 detik.");
  }

  // ==== lobby 15 s countdown (drives both countdown tiles + auto start) ====
  function lobbyTick() {
    if (state.screen === "lobby" && state.lobbyDeadline) {
      const left = Math.max(0, state.lobbyDeadline - Date.now()) / 1000;
      $("lbCountTitle").textContent = "ARENA MULAI DALAM";
      $("lbCount").textContent = String(Math.ceil(left)).padStart(2, "0");
      $("lbCountHint").textContent = "kursi terkunci · semua kursi dianggap siap";
      if (left <= 0) { state.lobbyDeadline = 0; state.countdown = false; gateArena(); }
    }
    if (state.screen === "arena") gameTick();
    setTimeout(lobbyTick, 100);
  }
  setTimeout(lobbyTick, 100);

  // ==== arena session ====
  // every entry point (ready countdown, SKIP TO MATCH) lands here and asks for
  // a wallet first; already connected = straight in, no repeated prompt
  function gateArena() {
    state.lobbyDeadline = 0;
    state.countdown = false;
    if (wallet.addr) enterArena();
    else openWallet();
  }
  function enterArena() {
    state.ready = false;
    state.lobbyDeadline = 0;
    state.paused = false;
    navigate("arena");
    ensureGame().newMatch({
      nick: state.nick, seats: state.players, credits: state.credits,
      botNames: AI_NAMES, seatColors: SEAT_COLORS, soundOn: state.soundOn,
      onFinish: (r) => { state.result = r; setTimeout(() => { leaveArena(); navigate("result"); }, 900); },
      toast: (m) => toast(m, true),
    });
  }
  // leaveArena only stops the running match — the renderer is built once in
  // ensureGame() and reused, so disposing here would leak a context per visit
  function leaveArena() { state.paused = true; boot3d?.stop(); }
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
    if (e.code === "KeyE" && !e.repeat) ensureGame().pressPass();
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
    $("rPool").textContent = String(r.credits * r.seatCount);
  }

  // ==== actions registry (same data-action dispatch as the reference) ====
  const ACTIONS = {
    home: () => { navigate("home"); $("modal").classList.add("hidden"); },
    how: () => $("modal").classList.remove("hidden"),
    "close-modal": () => $("modal").classList.add("hidden"),
    create: () => { refreshCreate(); navigate("create"); },
    "confirm-create": () => {
      const nick = readName();
      if (nick.length < 2) { $("fErr").textContent = "Nickname minimal 2 karakter."; return; }
      state.nick = nick;
      state.code = newCode();
      state.ready = false; state.lobbyDeadline = 0; state.countdown = false;
      navigate("lobby");
    },
    "toggle-ready": () => {
      if (state.ready) { state.ready = false; state.lobbyDeadline = 0; state.countdown = false; renderLobby(); toast("Siap dibatalkan."); }
      else startLobbyCountdown();
    },
    // entering the arena goes through the wallet gate first (demo: optional)
    start: gateArena,
    "wallet-connect": async () => {
      if (await walletConnect()) { closeWallet(); enterArena(); }
    },
    "wallet-skip": () => { closeWallet(); enterArena(); },
    "close-wallet": closeWallet,
    "copy-code": () => {
      const val = state.code;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(val).then(() => toast("Kode disalin: " + val), () => toast("Kode: " + val));
      else toast("Kode: " + val);
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
  const hash = (location.hash || "/").replace(/^#/, "");
  const initial = hash === "/rooms/create" ? "create" : hash.startsWith("/room/") ? "lobby" : "home";
  if (initial === "lobby") { state.code = decodeURIComponent(hash.split("/")[2] || state.code); }
  navigate(initial);
})();

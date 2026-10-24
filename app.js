// BOMB RUSH — single-page flow adapted from reference/BOMB_RUSH_Frontend (screens:
// home → create → lobby → arena → result + how-to-play modal + toasts + touch HUD),
// but gameplay runs on the project's own authoritative sim (src/game/sim.js) rendered
// through the project's own 3D assets (src/assets/*). No Canvas-2.5D renderer here.
import { bootMatch } from "./src/game/engine.js";
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
    game: null, // {room, avatars, api,...} once arena is up
    paused: false, soundOn: true,
  };

  // ==== navigation (same screen choreography, Indonesian copy) ====
  const ROUTES = { home: "/", create: "/rooms/create", lobby: "/room/" + state.code, arena: "/match", result: "/results" };
  function navigate(next) {
    state.screen = next;
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === "screen-" + next));
    document.body.classList.toggle("playing", next === "arena");
    if (next === "home") location.hash = "";
    else if (ROUTES[next]) location.hash = ROUTES[next];
    if (next === "lobby") renderLobby();
    if (next === "result") renderResult();
  }

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
        <small class="st${ready ? "" : " wait"}">${ready ? "✓ SIAP" : "BELUM SIAP"}</small></div>`);
    }
    $("lbReady").innerHTML = state.ready ? "✓ SIAP! <span>↗</span>" : "SAYA SIAP <span>↗</span>";
    $("lbEntry").textContent = `${state.credits} KREDITS DEMO`;
    $("lbPool").textContent = `${state.credits * state.players} KREDITS DEMO`;
    $("lbSeatsN").textContent = String(state.players).padStart(2, "0");
    $("lbDur").textContent = `${(state.players - 1) * 10} DETIK NOMINAL`;
  }
  function startLobbyCountdown() {
    state.ready = true;
    state.lobbyDeadline = Date.now() + 15000;
    state.countdown = true;
    renderLobby();
    toast("Squad siap. Match mulai dalam 15 detik!");
  }

  // ==== lobby 15 s countdown (drives both countdown tiles + auto start) ====
  function lobbyTick() {
    if (state.screen === "lobby" && state.lobbyDeadline) {
      const left = Math.max(0, state.lobbyDeadline - Date.now()) / 1000;
      $("lbCountTitle").textContent = "ARENA MULAI DALAM";
      $("lbCount").textContent = String(Math.ceil(left)).padStart(2, "0");
      $("lbCountHint").textContent = "kursi terkunci · semua kursi dianggap siap";
      if (left <= 0) { state.lobbyDeadline = 0; state.countdown = false; enterArena(); }
    }
    if (state.screen === "arena") gameTick();
    setTimeout(lobbyTick, 100);
  }
  setTimeout(lobbyTick, 100);

  // ==== arena session ====
  function enterArena() {
    state.ready = false;
    state.lobbyDeadline = 0;
    state.paused = false;
    navigate("arena");
    ensureGame().newMatch({
      nick: state.nick, seats: state.players, credits: state.credits,
      botNames: AI_NAMES, seatColors: SEAT_COLORS, soundOn: state.soundOn,
      onFinish: (r) => { state.result = r; setTimeout(() => navigate("result"), 900); },
      toast: (m) => toast(m, true),
    });
  }
  function leaveArena() { state.paused = true; ensureGame().dispose(); boot3d = null; }
  function pauseGame() {
    if (state.screen !== "arena" || state.game?.room?.over) return;
    state.paused = true;
    $("oPause").classList.remove("hidden");
  }
  function resumeGame() { $("oPause").classList.add("hidden"); state.paused = false; }
  on("btnSound", "click", () => { state.soundOn = !state.soundOn; $("btnSound").textContent = state.soundOn ? "🔊" : "🔇"; ensureGame().setSound(state.soundOn); });

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
    start: () => { state.lobbyDeadline = 0; state.countdown = false; enterArena(); }, // "SKIP KE MATCH"
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
  const hash = location.hash || "/";
  const initial = hash === "/rooms/create" ? "create" : hash.startsWith("/room/") ? "lobby" : "home";
  if (initial === "lobby") { state.code = decodeURIComponent(hash.split("/")[2] || state.code); }
  navigate(initial);
})();

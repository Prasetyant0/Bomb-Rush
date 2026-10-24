// engine.js — arena layer: drives src/game/sim.js (20 Hz fixed-step) through the
// project's own 3D assets (src/assets/*). The screen flow (lobby → match → result)
// lives in ../../app.js; this module exposes the in-arena session API it needs:
//   newMatch({nick, seats, credits, botNames, seatColors, soundOn, onFinish, toast})
//   pressPass() / hudSync() / setSound(on) / dispose()
// Real server later = same sim module hosted at 20 Hz over Socket.IO snapshots.
import * as THREE from "three";
import { createArena, createThirdPersonCamera } from "../assets/ArenaScene.js";
import { createAvatar, HATS, createTargetRing } from "../assets/PlayerAvatar3D.js";
import { createBomb } from "../assets/BombModel.js";
import { PALETTE, PLAYER_PALETTES } from "../assets/style.js";
import { makeRoom, addPlayer, startRound, step, pass, input, driveBots, PASS_RANGE } from "./sim.js";
import { SFX } from "./sfx.js";

const DT = 1 / 20; // 20 Hz local authority tick (SYS.md §5)
const BOMB_TIMER = 10; // s — sim resets per round; used for HUD-only cues
const CUE_MS = 1400; // GET ROUND / GET READY banner time

export function bootMatch(host) {
  // ---- renderer / scene / camera (built once, reused across matches) ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth || innerWidth, host.clientHeight || innerHeight);
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.Fog(PALETTE.bg, 16, 40);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb9a7ff, 0.8);
  fill.position.set(-5, 3, 2);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const arena = createArena();
  scene.add(arena);

  const camera = createThirdPersonCamera(host.clientWidth / host.clientHeight);
  scene.add(camera); // so avatar-held bomb children stay in graph even if we reparent
  const orbit = camera.userData.orbit;

  // shared match-scoped objects created per match (avatars differ per seat count)
  let room = null, avatars = [], targetRing = null, bomb3d = null, glyph = null, disposables = [];
  let matchOpts = null, onFinish = null, toastFn = () => {};
  let snapPrev = [], snapCurr = [], lastRound = -1, snapAlpha = 0;
  let cueUntil = 0, cueText = "", cueSub = "";
  let paused = false, retimer = 0;

  // ---- input (per-match regenerable) ----
  const keys = {};
  const joyVec = { x: 0, z: 0 };
  let pointers = { joy: null, cam: null, drag: null };
  const clearKeys = () => { for (const k in keys) keys[k] = false; };

  // ---- audio is optional (mp3 assets in assets/music) ----
  const sfx = SFX({ on: true });

  // ---- makeWall: nothing — fixed-step loop and sim run inside render below ----
  function newMatch(opts) {
    matchOpts = opts || {};
    onFinish = opts.onFinish || null;
    toastFn = opts.toast || (() => {});
    sfx.on = opts.soundOn !== false;
    // clear previous matches
    disposeMatch();
    room = makeRoom(opts.code || "DEMO");
    addPlayer(room, opts.nick || "YOU"); // seat 0 = local player always
    const n = Math.max(3, Math.min(4, opts.seats || 4));
    for (let i = 1; i < n; i++) addPlayer(room, (opts.botNames || ["NOVA", "ECHO", "JINX"])[i - 1] || `BOT-${i}`);
    startRound(room, Math.random());

    // avatars + nameplates
    const costumes = Object.keys(HATS);
    avatars = room.players.map((p, i) => {
      const a = createAvatar({ costume: costumes[i % costumes.length], skin: i % 5, palette: i % 4, outfit: true });
      a.userData.nameplate.add(nameplate(p.name || "P" + i, PLAYER_PALETTES[i % 4], (opts.seatColors || [])[i]));
      scene.add(a);
      return a;
    });
    // held bomb + overhead glyph follow the holder
    bomb3d = createBomb();
    bomb3d.scale.setScalar(0.7);
    bomb3d.position.set(0.34, 1.0, 0.4);
    let bombHost = null;
    glyph = createBomb();
    glyph.scale.setScalar(0.22);
    glyph.position.y = 0.42;
    let glyphHost = null;

    targetRing = createTargetRing();
    scene.add(targetRing);

    snapPrev = room.players.map(() => ({ x: 0, z: 0 }));
    snapCurr = room.players.map((p) => ({ x: p.pos.x, z: p.pos.z }));
    lastRound = room.round;

    // arena pan + target ring anchoring
    arena.position.set(0, 0, 0);

    // stored per-match so render() can move them
    session = { bomb3d, glyph, arena, r: room, avatars, snapPrev, snapCurr, get lastRound() { return lastRound; }, set lastRound(v) { lastRound = v; }, bombHost: null, glyphHost: null };
    cue({ text: "SIAP-SIAP", sub: `SEPULUH DETIK PER BOM` });
    resetCamera();
    g("hYouName").textContent = opts.nick || "YOU";
    g("hYouAva").textContent = (opts.nick || "YOU")[0];
    g("hYouAva").style.setProperty("--yu", (opts.seatColors || [])[0] || "#b59aff");
    g("hYouAva").style.background = (opts.seatColors || [])[0] || "#b59aff";
    sfx.play("handoff_sfx");
    if (matchOpts.soundOn !== false && sfx.music) sfx.music("arcade_chase");
  }
  function disposeMatch() {
    for (const o of [avatars, targetRing, bomb3d, glyph, ...(disposables || [])]) {
      if (!o) continue;
      (Array.isArray(o) ? o : [o]).forEach((x) => scene.remove(x));
    }
    avatars = []; targetRing = bomb3d = glyph = null; disposables = [];
  }
  function dispose() { disposeMatch(); renderer.setAnimationLoop(null); renderer.dispose(); }

  // session is created in the loop section below (module hoists `let session`)

  // ---- HUD: the static markup in index.html is the single source of markup.
  // This module only writes values into it (no duplicate element creation).
  const hostDoc = host.ownerDocument;
  const g = (id) => hostDoc.getElementById(id);
  // 5 partial-fill stamina segments (design.md GC §4: exact server value)
  const barEls = [...(g("hStamBars")?.children ?? [])];
  for (const seg of barEls) {
    seg.innerHTML = `<div style="position:absolute;inset:0;background:#56485f"></div>
      <div style="position:absolute;inset:0;width:0%;background:#7ed957"></div>`;
  }
  const feed = document.createElement("div");
  feed.id = "hFeed";
  feed.style.cssText = `position:absolute;left:26px;bottom:96px;font:600 11px var(--fb);color:#b9a7ff;opacity:.85;white-space:pre-line;max-width:420px;pointer-events:none;z-index:5`;
  host.appendChild(feed);

  // ---- round & pass cranks usable from app.js ----
  function pressPass() {
    if (!room || room.over) return false;
    const res = pass(room, 0);
    if (res.ok) {
      toastFn(`BOM DIOPER KE ${room.players[res.to].name}!`);
      sfx.play("handoff_sfx");
      cue({ text: "ROUND " + String(room.round).padStart(2, "0"), sub: "TERUS BERGERAK" });
    } else if (res.err === "cooldown") toastFn("Oper masih cooldown.");
    else if (res.err === "no-target") toastFn("Dekati pemain lain ≤1.8 unit untuk oper!");
    return res.ok;
  }
  function resetCamera() {
    orbit.yaw = 0;
    orbit.pitch = THREE.MathUtils.degToRad(35);
    orbit.distance = 9;
  }
  function cue({ text, sub }) { cueText = text; cueSub = sub; cueUntil = performance.now() + CUE_MS; }

  // ---- input wiring (built once; routed to the live room, guarded) ----
  addEventListener("keydown", (e) => {
    if (paused || !session.r || (e.target?.closest?.("input,textarea"))) return;
    if (e.repeat) return;
    if (e.code === "KeyE") pressPass();
    else if (e.code === "KeyR") startRound(session.r, Math.random());
    else keys[e.code] = true;
    if (["Space", "ShiftLeft", "ShiftRight"].includes(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => (keys[e.code] = false));
  addEventListener("blur", () => { clearKeys(); releaseTouches(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearKeys(); releaseTouches(); } });

  // mouse drag orbit + wheel zoom (7..11 clamp inside camera)
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    if (e.button !== 0) return;
    pointers.drag = { x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  addEventListener("pointermove", (e) => {
    if (pointers.drag) {
      orbit.yaw -= (e.clientX - pointers.drag.x) * 0.005;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - pointers.drag.y) * 0.005,
        THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(65));
      pointers.drag = { x: e.clientX, y: e.clientY };
    }
  });
  addEventListener("pointerup", () => (pointers.drag = null));
  addEventListener("wheel", (e) => { orbit.distance = THREE.MathUtils.clamp(orbit.distance + e.deltaY * 0.01, 7, 11); }, { passive: true });

  // ---- touch controls (called from app.js's static markup atoms; see styles.css) ----
  function bindTouch() {
    const pad = document.getElementById("tJoy"), zone = document.getElementById("tCam"),
      knob = document.getElementById("tKnob"), run = document.getElementById("tRun"), passBtn = document.getElementById("tPass");
    if (!pad) return;
    pad.addEventListener("pointerdown", (e) => { if (pointers.joy !== null) return; e.preventDefault(); pointers.joy = e.pointerId; pad.setPointerCapture(e.pointerId); updateStick(e); });
    pad.addEventListener("pointermove", (e) => { if (pointers.joy === e.pointerId) updateStick(e); });
    ["pointerup", "pointercancel"].forEach((ev) => pad.addEventListener(ev, (e) => {
      if (pointers.joy !== e.pointerId) return;
      pointers.joy = null; joyVec.x = joyVec.z = 0;
      knob.style.left = "50%"; knob.style.top = "50%";
    }));
    function updateStick(e) {
      const r = pad.querySelector(".joybase").getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy, lim = 30, l = Math.hypot(dx, dy);
      const f = Math.min(l, lim) / (l || 1);
      joyVec.x = (dx * f) / lim; joyVec.z = (dy * f) / lim;
      knob.style.left = `calc(50% + ${dx * f}px)`;
      knob.style.top = `calc(50% + ${dy * f}px)`;
    }
    let oldX = 0, oldY = 0;
    zone.addEventListener("pointerdown", (e) => { if (pointers.cam !== null) return; pointers.cam = e.pointerId; oldX = e.clientX; oldY = e.clientY; zone.setPointerCapture(e.pointerId); });
    zone.addEventListener("pointermove", (e) => {
      if (pointers.cam !== e.pointerId) return;
      orbit.yaw -= (e.clientX - oldX) * 0.007;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - oldY) * 0.005, THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(65));
      oldX = e.clientX; oldY = e.clientY;
    });
    ["pointerup", "pointercancel"].forEach((ev) => zone.addEventListener(ev, (e) => { if (pointers.cam === e.pointerId) pointers.cam = null; }));
    run.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!session.r) return;
      const me = session.r.players[0];
      if (me.stamina <= 0.5) return; // force-walk floor (GC §4): RUN toggle blocked
      me.wantsSprint = !me.wantsSprint;
      run.classList.toggle("on", me.wantsSprint);
    });
    passBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); pressPass(); });
  }
  function releaseTouches() {
    pointers = { joy: null, cam: null, drag: null };
    joyVec.x = joyVec.z = 0;
    const knob = document.getElementById("tKnob");
    if (knob) { knob.style.left = "50%"; knob.style.top = "50%"; }
    document.getElementById("tRun")?.classList.remove("on");
  }
  bindTouch();

  addEventListener("resize", () => {
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  });

  // ---- fixed-step 20 Hz sim + free-running render (the one loop in the module) ----
  const timer = new THREE.Timer();
  timer.connect(document);
  let acc = 0;
  let muted = false;
  let session = { r: null, finished: false };
  renderer.setAnimationLoop(() => {
    if (paused || !session.r) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    acc += dt;
    if (session.r.round !== lastRound) { // round reset → teleport all avatars, reset clock
      session.r.players.forEach((p) => {
        snapPrev[p.seat].x = snapCurr[p.seat].x = p.pos.x;
        snapPrev[p.seat].z = snapCurr[p.seat].z = p.pos.z;
      });
      lastRound = session.r.round;
      acc = 0;
    }
    while (acc >= DT) {
      session.r.players.forEach((p) => { snapPrev[p.seat].x = snapCurr[p.seat].x; snapPrev[p.seat].z = snapCurr[p.seat].z; });
      tickInput();
      step(session.r, DT);
      session.r.players.forEach((p) => { snapCurr[p.seat].x = p.pos.x; snapCurr[p.seat].z = p.pos.z; });
      acc -= DT;
    }
    snapAlpha = THREE.MathUtils.clamp(acc / DT, 0, 1);
    render(timer.getElapsed(), dt);
    // finish → announce once
    if (session.r.over && !session.finished) {
      session.finished = true;
      const win = session.r.players.find((p) => p.alive);
      sfx.play("victory_fanfare"); // assets/music/victory_fanfare.mp3
      onFinish?.({
        seatCount: session.r.players.length,
        credits: matchOpts.credits || 0,
        winnerName: win?.name || "—",
        winnerIsLocal: win?.seat === 0,
        winnerColor: (matchOpts.seatColors || [])[win?.seat] || "#ac90e8",
      });
    }
  });

  function tickInput() {
    const me = session.r.players[0];
    // world-fixed movement (camera never feeds through, GC §3 view only)
    const x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joyVec.x;
    const z = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + joyVec.z;
    input(me, x, z, keys.ShiftLeft || keys.ShiftRight);
    if (me.stamina <= 0) me.wantsSprint = false; // RUN toggle off at 0 (GC §4 / design.md §5)

    driveBots(session.r, 0); // demo bots, shared with the lobby preview
  }

  // ---- still / exhibition animations for spectate/round transitions ----
  function render(t, dt) {
    const r = session.r;
    const me = r.players[0];

    for (const p of r.players) {
      const a = avatars[p.seat];
      const pv = snapPrev[p.seat], cu = snapCurr[p.seat];
      a.position.set(pv.x + (cu.x - pv.x) * snapAlpha, 0, pv.z + (cu.z - pv.z) * snapAlpha);
      if (p.move.len() > 0.01) a.rotation.y = Math.atan2(p.move.x, p.move.z);
      a.userData.pose({ moving: p.moving, sprinting: p.isSprinting }, t + p.seat * 0.7, dt);
      a.visible = p.alive;
      const f = p.face; // sim drives: idle | panic | happy | dizzy (avatars opt-in)
      if (p.alive && f && f !== "idle") a.userData.face?.userData.express(f, t);
      else a.userData.face?.userData.express("idle", t);
      a.userData.face?.userData.tick?.(t);
    }
    arena.userData.tick?.(t);

    // bomb follows the holder; blink fast at ≤3 s (design.md §2)
    const holder = r.players[r.holderSeat];
    const holderLive = holder?.alive && !r.over;
    if (session.bombHost !== holderLive || (holderLive && session.bombHost !== avatars[holder.seat])) {
      if (session.bombHost) session.bombHost.remove(bomb3d);
      session.bombHost = holderLive ? avatars[holder.seat] : null;
      if (session.bombHost) session.bombHost.add(bomb3d);
    }
    if (session.glyphHost !== session.bombHost) {
      avatars.forEach((a) => a.userData.setBombGlyph(null));
      session.glyphHost = session.bombHost;
      if (session.glyphHost) session.glyphHost.userData.setBombGlyph(glyph);
    }
    if (session.bombHost) {
      bomb3d.userData.tick?.(t);
      glyph.userData.tick?.(t);
      const near = r.bombTimer <= 3;
      bomb3d.visible = near ? Math.sin(t * 14) > 0 : true;
      glyph.visible = near ? Math.sin(t * 14) > 0 : true;
      if (near && r.bombTimer > 0) sfx.alarm();
      else sfx.stopAlarm();
    } else sfx.stopAlarm();

    // target ring: nearest passable target under GC §5 (same rule as sim)
    let ringTarget = null;
    if (r.holderSeat === 0 && me.alive && !r.over) {
      let bestD = PASS_RANGE;
      for (const p of r.players) {
        if (!p.alive || p.seat === 0) continue;
        const d = p.pos.sub(me.pos).len();
        if (d <= bestD) { bestD = d; ringTarget = p; }
      }
    }
    if (ringTarget) {
      const ra = avatars[ringTarget.seat].position;
      targetRing.visible = true;
      targetRing.position.set(ra.x, 0.04, ra.z);
      targetRing.userData.tick?.(t);
    } else targetRing.visible = false;

    // camera follows YOU while alive, else the holder (spectate)
    const anchor = me.alive ? me.pos : r.players[r.holderSeat]?.pos ?? me.pos;
    camera.userData.follow({ x: anchor.x, y: 0, z: anchor.z }, timer.getDelta());

    hudSync();
    renderer.render(scene, camera);
  }

  // HUD numbers only — called every frame via the loop plus at app.js's 10 Hz
  function hudSync() {
    if (!session.r) return;
    const r = session.r, me = r.players[0];
    const t = Math.max(0, r.bombTimer);
    g("hTimer").textContent = t.toFixed(2).padStart(5, "0");
    g("hTimer").closest(".htimer").classList.toggle("danger", t <= 3);
    g("hRound").textContent = `ROUND ${String(r.round).padStart(2, "0")} / ${String(r.players.length - 1).padStart(2, "0")}`;
    g("hHolder").textContent = `PENGGUNA BOM: ${r.over ? "— SELESAI" : r.players[r.holderSeat]?.name || "—"}`;
    // cue: timed banner (set via cue())
    const cueVisible = performance.now() < cueUntil;
    const cueEl = g("hCue");
    if (cueVisible && !cueEl.classList.contains("on")) {
      g("hCueT").textContent = cueText;
      g("hCueS").textContent = cueSub;
      cueEl.classList.add("on");
    } else if (!cueVisible) cueEl.classList.remove("on");
    // bomb alert visible when YOU hold it and the initial cue faded
    g("hAlert").classList.toggle("on", r.holderSeat === 0 && me.alive && !r.over && performance.now() > cueUntil);
    // stamina, exact server value (GC §4)
    g("hStamN").textContent = me.stamina.toFixed(1) + " / 5";
    barEls.forEach((seg, i) => {
      const inner = seg.children[1];
      inner.style.width = `${THREE.MathUtils.clamp(me.stamina - i, 0, 1) * 100}%`;
      inner.style.background = me.isSprinting ? "#f6bd67" : "#7ed957";
    });
    const st = g("hStamTx");
    if (me.isSprinting) { st.textContent = "LARI"; st.style.color = "#f6bd67"; }
    else if (me.stamina < 5 && r.clock - me.lastSprintEndedAt < 1.5) { st.textContent = "PULIH…"; st.style.color = "#ff667e"; }
    else if (me.stamina < 5) { st.textContent = "ISI ULANG"; st.style.color = "#63e8f2"; }
    else { st.textContent = "SIAP"; st.style.color = "#7ed957"; }
    feed.textContent = r.feed.slice(-3).map((f) => `${f.at}s · ${f.msg}`).join("\n");
    // eliminated overlay + spectate
    const spec = g("oSpec");
    if (spec) spec.classList.toggle("hidden", me.alive || r.over);
    const myRun = g("tRun");
    if (myRun && me.stamina <= 0.5 && !me.isSprinting) myRun.classList.remove("on"); // forced walk
  }

  // ---- nameplate sprite (design.md §2) ----
  function nameplate(name, pal, cssColor) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(33,26,57,0.75)";
    ctx.beginPath(); ctx.roundRect(8, 8, 240, 48, 12); ctx.fill();
    ctx.strokeStyle = cssColor ? cssColor + "aa" : "#" + pal.accent.toString(16).padStart(6, "0") + "88";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(8, 8, 240, 48, 12); ctx.stroke();
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = cssColor || "#" + pal.accent.toString(16).padStart(6, "0");
    ctx.fillText(name, 128, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(1.4, 0.35, 1);
    disposables.push(tex, s.material);
    return s;
  }

  // ---- control surface consumed by app.js ----
  return {
    newMatch, dispose,
    pressPass, hudSync,
    setSound(on) { sfx.on = on; if (!on) sfx.stopAlarm(); },
    get room() { return session.r; },
  };
}

// lobbyPreview.js — looping gameplay simulation shown beside the lobby panel.
// Reuses the real match stack (sim.js + src/assets/*): four bots play by the same
// rules while an orbit camera follows the bomb holder. No input, no audio, no HUD —
// a moving illustration of the round the player is about to join.
import * as THREE from "three";
import { createArena } from "../assets/ArenaScene.js";
import { createAvatar, HATS } from "../assets/PlayerAvatar3D.js";
import { createBomb } from "../assets/BombModel.js";
import { PALETTE } from "../assets/style.js";
import { makeRoom, addPlayer, startRound, step, driveBots, ARENA_RADIUS } from "./sim.js";

export function bootLobbyPreview(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

  // high, wide orbit over the arena centre — the whole octagon stays in frame,
  // so the panel always reads as a game, never as an empty corner
  const FOV = 55;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const orbit = { yaw: 0.4, pitch: THREE.MathUtils.degToRad(52) };

  const room = makeRoom("PREVIEW");
  ["NOVA", "ECHO", "JINX", "BYTE"].forEach((n) => addPlayer(room, n));
  startRound(room, Math.random());

  const costumes = Object.keys(HATS);
  const avatars = room.players.map((p, i) => {
    const a = createAvatar({ costume: costumes[i % costumes.length], skin: i % 5, palette: i % 4, outfit: true });
    scene.add(a);
    return a;
  });

  const bomb = createBomb();
  bomb.scale.setScalar(0.7);
  bomb.position.set(0.34, 1.0, 0.4);
  let bombHost = null;

  // ---- sizing: the figure stretches to the lobby panel's height ----
  // pull back until every rim point lands inside the frame — exact for any aspect
  let dist = 24;
  const RIM = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2, r = ARENA_RADIUS + 0.6; // barrier only, not the base skirt
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  });
  const _p = new THREE.Vector3();
  function placeCamera(d) {
    const cp = Math.cos(orbit.pitch);
    camera.position.set(Math.sin(orbit.yaw) * d * cp, d * Math.sin(orbit.pitch), Math.cos(orbit.yaw) * d * cp);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld();
  }
  function fits(d) {
    camera.updateProjectionMatrix();
    placeCamera(d);
    return RIM.every((p) => {
      _p.copy(p).project(camera);
      return Math.abs(_p.x) <= 0.86 && Math.abs(_p.y) <= 0.86; // air for avatar + bomb
    });
  }
  // bisect the closest distance where the whole rim is inside the frame
  function fitDist() {
    let lo = 10, hi = 90;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    return hi;
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dist = fitDist();
    placeCamera(dist);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---- loop ----
  let active = false, last = 0;
  function frame(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;

    driveBots(room, -1); // every seat is a bot
    step(room, dt);
    if (room.over) { startRound(room, Math.random()); last = now; }
    const t = now / 1000;

    room.players.forEach((p, i) => {
      const a = avatars[i];
      a.position.set(p.pos.x, 0, p.pos.z);
      if (p.move.len() > 0.01) a.rotation.y = Math.atan2(p.move.x, p.move.z);
      a.userData.pose({ moving: p.moving, sprinting: p.isSprinting }, t + i * 0.7, dt);
      a.visible = p.alive;
      a.userData.face?.userData.express(p.alive && p.face !== "idle" && p.face ? p.face : "idle", t);
      a.userData.face?.userData.tick?.(t);
    });
    arena.userData.tick?.(t);

    // bomb rides the holder (hidden with an eliminated holder, as in the match)
    const holder = room.players[room.holderSeat];
    const host3d = holder?.alive ? avatars[holder.seat] : null;
    if (host3d !== bombHost) {
      if (bombHost) bombHost.remove(bomb);
      bombHost = host3d;
      if (bombHost) bombHost.add(bomb);
    }
    if (bombHost) {
      bomb.userData.tick?.(t);
      const near = room.bombTimer <= 3;
      bomb.visible = near ? Math.sin(t * 14) > 0 : true;
    }

    // slow drift around the arena; `dist` comes from resize() so the playfield
    // always fits the panel instead of cropping
    orbit.yaw += dt * 0.16;
    placeCamera(dist);
    renderer.render(scene, camera);
  }

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      last = 0;
      renderer.setAnimationLoop(on ? frame : null);
      if (on) resize(); // the panel may have moved to a different-sized slot
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      avatars.forEach((a) => scene.remove(a));
      scene.remove(arena);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// ArenaScene base — raised octagonal platform, mild rim, concentric glowing rings.
// Per design.md v0.3 §2: one compact flat arena ~20 units wide,
// central brighter area, dimmer outer border, no obstacles in MVP.
// View is third-person orbit-follow (createThirdPersonCamera below) — fixed
// isometric is no longer approved.
import * as THREE from "three";
import { PALETTE, mat } from "./style.js";

export const ARENA_RADIUS = 10;

export function createArena() {
  const arena = new THREE.Group();

  // raised platform — 8-sided, flat-shaded so the facets read crisp
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS + 0.6, 1.2, 8),
    mat(PALETTE.panel, { rough: 0.8, flat: true }),
  );
  base.position.y = -0.6;
  base.receiveShadow = true;
  arena.add(base);

  // play surface — brighter in the center via a radial canvas texture
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS, 8),
    new THREE.MeshStandardMaterial({ map: surfaceTexture(), roughness: 0.85 }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.005;
  surface.receiveShadow = true;
  arena.add(surface);

  // low barrier: octagonal torus ring around the edge (8 tubular segments)
  const barrier = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS, 0.35, 12, 8),
    mat(PALETTE.primary, { rough: 0.4, flat: true }),
  );
  barrier.rotation.x = Math.PI / 2;
  barrier.position.y = 0.25;
  arena.add(barrier);

  // concentric glowing rings (center-out, cyan→lavender); 7.5 max stays
  // inside the octagon inradius (10·cos 22.5° ≈ 9.24) even when breathed out
  for (let i = 0; i < 3; i++) {
    const r = 2.5 + i * 2.5;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.09, r + 0.09, 8),
      new THREE.MeshBasicMaterial({
        color: i === 0 ? PALETTE.cyan : PALETTE.lavender,
        transparent: true,
        opacity: 0.5 - i * 0.12,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02 + i * 0.005; // stagger to avoid z-fighting
    arena.add(ring);
    arena.userData[`ring${i}`] = ring;
  }

  // center emblem
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0.6 }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.01;
  arena.add(core);

  arena.userData.tick = (t) => {
    // rings breathe outward; skip under reduced-motion (caller sets flag)
    if (arena.userData.reducedMotion) return;
    for (let i = 0; i < 3; i++) {
      const ring = arena.userData[`ring${i}`];
      const p = ((t * 0.35 + i / 3) % 1);
      ring.scale.setScalar(1 + p * 0.18);
      ring.material.opacity = (0.5 - i * 0.12) * (1 - p) * (0.8 + 0.2 * Math.sin(t * 2));
    }
  };

  return arena;
}

// radial gradient: bright center → dim purple border (design.md §3)
let _surfTex;
function surfaceTexture() {
  if (_surfTex) return _surfTex;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
  g.addColorStop(0, "#2c2452");
  g.addColorStop(0.55, "#211a39");
  g.addColorStop(1, "#171227");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  _surfTex = new THREE.CanvasTexture(c);
  _surfTex.colorSpace = THREE.SRGBColorSpace;
  return _surfTex;
}

// Third-person orbit-follow camera (design.md v0.3 §2, GAMEPLAY_CONTROLS §3):
// damped follow of a pivot at avatar position + head height, yaw 360°,
// pitch clamped 20–65°, zoom 7–11 units. Client-owned view only — never
// affects server movement, collision or stamina rules.
// Default yaw 0: camera parks at pivot + (0, h, +d), looking −z, so the
// world-fixed WASD map (W=−z, D=+x) reads correctly on screen: W = away from
// camera (screen up), D = screen right.
const _pivotTarget = new THREE.Vector3();
export function createThirdPersonCamera(aspect, { distance = 9, yaw = 0, pitch = THREE.MathUtils.degToRad(35) } = {}) {
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 150);
  const orbit = {
    yaw,
    pitch: THREE.MathUtils.clamp(pitch, THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(65)),
    distance,
  };
  const pivot = new THREE.Vector3(0, 1.4, 0);
  camera.userData.orbit = orbit;
  camera.userData.follow = (targetPos, dt) => {
    // frame-rate-independent exponential damping on the pivot
    pivot.lerp(_pivotTarget.set(targetPos.x, targetPos.y + 1.4, targetPos.z), 1 - Math.exp(-8 * Math.min(dt, 0.1)));
    const d = THREE.MathUtils.clamp(orbit.distance, 7, 11);
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      pivot.x + d * cp * Math.sin(orbit.yaw),
      pivot.y + d * Math.sin(orbit.pitch),
      pivot.z + d * cp * Math.cos(orbit.yaw),
    );
    camera.lookAt(pivot);
  };
  return camera;
}

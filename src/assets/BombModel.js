// BombModel — procedural bomb per design.md §2:
// sphere body, emissive shell, fuse, red orbit ring, glow sprite, timer ring.
import * as THREE from "three";
import { PALETTE, mat } from "./style.js";

export function createBomb() {
  const bomb = new THREE.Group();

  // Body: dark sphere
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), mat(0x1d1a2e, { rough: 0.35 }));
  bomb.add(body);

  // Emissive shell: slightly larger transparent sphere tinted coral, pulsing in tick()
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 24, 16),
    new THREE.MeshBasicMaterial({
      color: PALETTE.coral,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  bomb.add(shell);

  // Cap + fuse
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.14, 12), mat(PALETTE.amber, { rough: 0.4 }));
  cap.position.y = 0.52;
  bomb.add(cap);

  const fuse = new THREE.Mesh(new THREE.TubeGeometry(fuseCurve(), 16, 0.03, 6), mat(0xd8c9a8, { rough: 0.9 }));
  fuse.position.y = 0.58;
  bomb.add(fuse);

  // Spark tip: small glowing sphere, flickers in tick()
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  );
  spark.position.y = 0.72;
  bomb.add(spark);

  // Red orbit ring: carrier contour halo (design.md §3)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.03, 8, 48),
    new THREE.MeshBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  bomb.add(ring);

  // Glow: billboard sprite behind everything
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: PALETTE.coral,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(2.6);
  bomb.add(glow);

  bomb.userData.tick = (t) => {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    shell.material.opacity = 0.15 + 0.2 * pulse;
    shell.scale.setScalar(1 + 0.05 * pulse);
    spark.material.color.setHSL(0.08, 1, 0.5 + 0.2 * Math.sin(t * 20));
    ring.rotation.z = t * 2;
    glow.material.opacity = 0.35 + 0.25 * pulse;
  };

  return bomb;
}

function fuseCurve() {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.06, 0.04, 0.03),
    new THREE.Vector3(-0.05, 0.09, -0.02),
    new THREE.Vector3(0.04, 0.13, 0),
  ]);
}

// Radial-gradient glow sprite, generated once.
let _glowTex;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

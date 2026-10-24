// Props3D — toy props from the reference "30 interactive props" sheet, rebuilt
// procedurally in the same chunky style: rounded primitives, bright toy colors.
// Decorative dressing for arena/lobby — not gameplay obstacles (design.md: none in MVP).
import * as THREE from "three";
import { mat } from "./style.js";

const box = (w, h, d, color, o = {}) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o));
const cyl = (rt, rb, h, color, o = {}, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, o));
const sph = (r, color, o = {}, w = 14, hs = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, w, hs), mat(color, o));
const tor = (r, t, color, o = {}, arc = Math.PI * 2) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 24, arc), mat(color, o));

export const PROPS = {
  boombox(g) {
    const body = box(1.0, 0.5, 0.42, 0xd8d3e8, { rough: 0.5 });
    body.position.y = 0.4;
    g.add(body);
    const tape = box(0.3, 0.18, 0.05, 0x2a2038, { rough: 0.4 });
    tape.position.set(0, 0.46, 0.22);
    g.add(tape);
    const speakers = [];
    for (const s of [-1, 1]) {
      const sp = cyl(0.16, 0.16, 0.07, 0xf6bd67, { rough: 0.5 });
      sp.rotation.x = Math.PI / 2;
      sp.position.set(0.32 * s, 0.36, 0.23);
      g.add(sp);
      speakers.push(sp);
    }
    const handle = tor(0.3, 0.04, 0x2a2038, { rough: 0.5 }, Math.PI);
    handle.position.y = 0.65;
    g.add(handle);
    const ant = cyl(0.014, 0.014, 0.5, 0x8d93a1, { metal: 0.4 }, 6);
    ant.position.set(0.44, 0.82, -0.08);
    ant.rotation.z = -0.5;
    g.add(ant);
    [0xff667e, 0x63e8f2, 0x7ed957, 0xf6bd67].forEach((c, i) => {
      const btn = box(0.07, 0.05, 0.05, c, { rough: 0.4 });
      btn.position.set(-0.3 + i * 0.12, 0.67, 0.05);
      g.add(btn);
    });
    g.userData.tick = (t) => {
      const p = 1 + 0.08 * (0.5 + 0.5 * Math.sin(t * 6));
      speakers.forEach((sp) => sp.scale.setScalar(p));
    };
  },

  radio(g) {
    const b = box(0.52, 0.3, 0.2, 0x7a5236, { rough: 0.7 });
    b.position.y = 0.18;
    g.add(b);
    const face = box(0.4, 0.18, 0.04, 0xd8c9a8, { rough: 0.8 });
    face.position.set(-0.02, 0.18, 0.1);
    g.add(face);
    for (const s of [-1, 1]) {
      const dial = cyl(0.05, 0.05, 0.03, 0x2a2038, { rough: 0.4 });
      dial.rotation.x = Math.PI / 2;
      dial.position.set(-0.02 + 0.13 * s, 0.18, 0.13);
      g.add(dial);
    }
    const hnd = tor(0.16, 0.03, 0x8d93a1, { rough: 0.5, metal: 0.3 }, Math.PI);
    hnd.position.y = 0.33;
    g.add(hnd);
    const ant = cyl(0.012, 0.012, 0.55, 0x8d93a1, { metal: 0.5 }, 6);
    ant.position.set(0.22, 0.55, -0.05);
    ant.rotation.z = -0.35;
    g.add(ant);
  },

  teddy(g) {
    const fur = 0xb5713f, lite = 0xd89a6a;
    const body = sph(0.26, fur);
    body.position.y = 0.3;
    body.scale.set(1, 1.2, 0.9);
    g.add(body);
    const belly = sph(0.16, lite);
    belly.position.set(0, 0.26, 0.16);
    belly.scale.set(1, 1.1, 0.6);
    g.add(belly);
    const head = sph(0.22, fur);
    head.position.y = 0.72;
    g.add(head);
    const muzzle = sph(0.1, lite);
    muzzle.position.set(0, 0.68, 0.17);
    muzzle.scale.set(1.2, 0.8, 0.7);
    g.add(muzzle);
    const nose = sph(0.035, 0x2a2038);
    nose.position.set(0, 0.71, 0.26);
    g.add(nose);
    for (const s of [-1, 1]) {
      const ear = sph(0.08, fur);
      ear.position.set(0.16 * s, 0.9, 0);
      g.add(ear);
      const arm = sph(0.09, fur);
      arm.position.set(0.28 * s, 0.42, 0.06);
      g.add(arm);
      const leg = sph(0.11, fur);
      leg.position.set(0.15 * s, 0.1, 0.12);
      g.add(leg);
    }
  },

  beachBall(g) {
    const cols = [0xff667e, 0xf7f6ff, 0x7ed957];
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 10, (i * Math.PI) / 3, Math.PI / 3),
        mat(cols[i % 3], { rough: 0.5 }),
      );
      w.position.y = 0.3;
      g.add(w);
    }
  },

  guitar(g) {
    const wood = 0xf6bd67, dark = 0x7a5236;
    const lower = sph(0.28, wood, { rough: 0.6 });
    lower.scale.set(1, 0.38, 1.25);
    lower.position.set(0, 0.11, 0.12);
    g.add(lower);
    const upper = sph(0.2, wood, { rough: 0.6 });
    upper.scale.set(1, 0.38, 1.1);
    upper.position.set(0, 0.11, -0.24);
    g.add(upper);
    const hole = cyl(0.09, 0.09, 0.02, 0x2a2038, { rough: 0.6 });
    hole.position.set(0, 0.2, -0.02);
    g.add(hole);
    const bridge = box(0.14, 0.03, 0.05, dark);
    bridge.position.set(0, 0.2, 0.2);
    g.add(bridge);
    const neck = box(0.08, 0.04, 0.5, dark);
    neck.position.set(0, 0.14, -0.62);
    g.add(neck);
    const headS = box(0.12, 0.06, 0.14, dark);
    headS.position.set(0, 0.16, -0.92);
    g.add(headS);
  },

  megaphone(g) {
    const horn = cyl(0.07, 0.26, 0.5, 0xff667e, { rough: 0.5 });
    horn.position.y = 0.25;
    g.add(horn);
    const band = cyl(0.27, 0.27, 0.08, 0xf7f6ff, { rough: 0.5 });
    band.position.y = 0.46;
    g.add(band);
    const lip = tor(0.26, 0.03, 0xff667e, { rough: 0.5 });
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.5;
    g.add(lip);
    const mouth = sph(0.08, 0xff667e, { rough: 0.5 });
    mouth.position.y = 0.02;
    g.add(mouth);
    const grip = box(0.08, 0.2, 0.08, 0x2a2038, { rough: 0.6 });
    grip.position.set(0.16, 0.14, 0);
    grip.rotation.z = -0.3;
    g.add(grip);
  },

  dumbbell(g) {
    const bar = cyl(0.05, 0.05, 0.62, 0x8d93a1, { metal: 0.3 });
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.14;
    g.add(bar);
    for (const s of [-1, 1]) {
      const a = cyl(0.13, 0.13, 0.11, 0x2a2038, { rough: 0.5 });
      a.rotation.z = Math.PI / 2;
      a.position.set(0.26 * s, 0.14, 0);
      g.add(a);
      const b = cyl(0.09, 0.09, 0.08, 0x2a2038, { rough: 0.5 });
      b.rotation.z = Math.PI / 2;
      b.position.set(0.35 * s, 0.14, 0);
      g.add(b);
    }
  },

  toyCar(g) {
    const body = box(0.5, 0.13, 0.26, 0xe64533, { rough: 0.5 });
    body.position.y = 0.13;
    g.add(body);
    const cabin = box(0.26, 0.12, 0.22, 0x63e8f2, { rough: 0.25 });
    cabin.position.set(-0.03, 0.25, 0);
    g.add(cabin);
    for (const [z, x] of [[-0.17, 0.15], [0.17, 0.15], [-0.17, -0.15], [0.17, -0.15]]) {
      const wheel = cyl(0.08, 0.08, 0.05, 0x2a2038, { rough: 0.7 });
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.08, z);
      g.add(wheel);
    }
  },

  flowerPot(g) {
    const pot = cyl(0.17, 0.12, 0.2, 0xf6a04d, { rough: 0.7 });
    pot.position.y = 0.1;
    g.add(pot);
    const soil = cyl(0.15, 0.15, 0.03, 0x5c3a24, { rough: 0.9 });
    soil.position.y = 0.2;
    g.add(soil);
    const stem = cyl(0.02, 0.02, 0.24, 0x7ed957, { rough: 0.6 }, 8);
    stem.position.y = 0.33;
    g.add(stem);
    const core = sph(0.055, 0xf6bd67, { rough: 0.5 });
    core.position.y = 0.48;
    g.add(core);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const petal = sph(0.06, 0xff667e, { rough: 0.5 });
      petal.position.set(Math.cos(a) * 0.1, 0.48, Math.sin(a) * 0.1);
      petal.scale.set(1, 0.7, 1);
      g.add(petal);
    }
  },

  plunger(g) {
    const cup = sph(0.17, 0xe64533, { rough: 0.55 });
    cup.scale.set(1, 0.6, 1);
    cup.position.y = 0.1;
    g.add(cup);
    const stick = cyl(0.026, 0.026, 0.42, 0xf2ede4, { rough: 0.8 }, 10);
    stick.position.y = 0.32;
    g.add(stick);
    const knob = sph(0.05, 0xf2ede4, { rough: 0.8 });
    knob.position.y = 0.55;
    g.add(knob);
  },
};

export function createProp(name) {
  const g = new THREE.Group();
  PROPS[name]?.(g);
  return g;
}

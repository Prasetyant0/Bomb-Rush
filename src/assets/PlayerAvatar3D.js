// PlayerAvatar3D — procedural chibi characters matching the assetreference style:
// oversized round head, dot eyes, stubby limbs, toy props for hats/costumes.
// 10 costume variants from the reference roster + 5 skin tones + 4 player palettes
// + fixed OUTFITS for the 5-character lineup sheet.
import * as THREE from "three";
import { PALETTE, PLAYER_PALETTES, SKIN_TONES, mat } from "./style.js";

// dot-eye face features, swappable expressions per the reference expression sheet
export const EXPRESSIONS = ["idle", "happy", "panic", "sad", "dizzy", "angry"];

// Fixed outfit per the 5-character lineup sheet (frog/chicken/miner/viking/crab).
// arms/legs: "skin" = bare; gloves recolors+inflates the hands; armor adds chest+skirt plates.
export const OUTFITS = {
  frog: { body: 0xf2a7c3, arms: 0xf2a7c3, legs: 0x37474f, shoes: 0x7ed957 },
  chicken: { body: 0xb84a5c, arms: 0xb84a5c, legs: 0x263238, shoes: 0x2a2038, gloves: 0xe64533 },
  miner: { body: 0xf7f6ff, arms: "skin", legs: 0x1e5e3a, shoes: 0x7a5236, gloves: 0x7ed957 },
  viking: { body: 0x8d93a1, arms: "skin", legs: 0x37474f, shoes: 0x2a2038, armor: true },
  crab: { body: 0xf68b2c, arms: 0xf68b2c, legs: 0x263238, shoes: 0x2a2038 },
  bunny: { body: 0xf2a7c3, arms: 0xf2a7c3, legs: 0x37474f, shoes: 0x2a2038 },
  hero: { body: 0x8367ef, arms: 0x8367ef, legs: 0x263238, shoes: 0xe64533, gloves: 0x7ed957 },
};

// Per-costume clothing detail — primitives layered proud of the base shapes so
// outfits read as real clothes, not recolors. Torso pieces parent to root (the
// torso lean in pose() is ≤0.18 rad — no visible gap at toy scale); cuffs and
// pockets parent into arms/legs so pose() carries them along.
const DRESS = {
  // hero: wide amber belt + round buckle at the waist, wrist cuffs
  hero({ root, arms }) {
    // ring radius 0.275 hugs the egg torso at y 0.56 (surface ≈0.27 there) —
    // tube half-sinks into the belly so it wraps with no gap and no poke-through
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.05, 10, 24), mat(0xf6bd67, { rough: 0.45 }));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.56;
    root.add(belt);
    const buckle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mat(0xf6bd67, { rough: 0.3, metal: 0.4 }));
    buckle.position.set(0, 0.56, 0.29);
    buckle.scale.z = 0.6;
    root.add(buckle);
    for (const arm of arms) {
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.032, 8, 18), mat(0xf6bd67, { rough: 0.45 }));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.16; // wrist end of the capsule (half-len 0.175)
      arm.add(cuff);
    }
  },

  // miner: over-the-shoulder suspender arcs + cargo pockets on the pants
  miner({ root, legs }) {
    for (const s of [-1, 1]) {
      // radius 0.275 matches the hero belt ring — wraps the belly, no clip
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.032, 8, 20, Math.PI), mat(0x7a5236, { rough: 0.7 }));
      strap.rotation.y = Math.PI / 2; // half-arc: front hem → over shoulder → back
      strap.position.set(0.12 * s, 0.77, 0);
      root.add(strap);
    }
    for (const leg of legs) {
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.025), mat(0x1e5e3a, { rough: 0.8 }));
      pocket.position.set(0, 0.03, 0.085); // hugs the 0.09 capsule (0.085+0.0125 = 0.0975 surface)
      leg.add(pocket);
    }
  },

  // bunny: thin belly zipper + pull tab + kangaroo hoodie pocket — all flush.
  // Zipper stops at y 0.72 so the universal chest emblem (bottom edge y0.72)
  // stays clear; boxes tilt 0.22 rad to follow the belly flare (dR/dY mid-belly).
  bunny({ root, surf }) {
    const tilt = 0.22;
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.02), mat(0xf7f6ff, { rough: 0.4 }));
    zip.position.set(0, 0.62, surf(0.62) + 0.005);
    zip.rotation.x = tilt;
    root.add(zip);
    const pull = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), mat(0xf7f6ff, { rough: 0.4 }));
    pull.position.set(0, 0.5, 0.27); // rides on the zipper front face
    root.add(pull);
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.035), mat(0xe08cb0, { rough: 0.7 }));
    pouch.position.set(0, 0.49, 0.26);
    pouch.rotation.x = tilt;
    root.add(pouch);
  },

  // frog: thick white jacket collar ringing the neck under the head
  frog({ root }) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.075, 10, 24), mat(0xf7f6ff, { rough: 0.6 }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.02; // between head pole (y1.0) and body top (y1.095)
    root.add(collar);
  },
};

export function createAvatar({ costume = "frog", skin = 0, palette = 0, outfit = false } = {}) {
  const root = new THREE.Group();
  const skinColor = SKIN_TONES[skin % SKIN_TONES.length];
  const pal = PLAYER_PALETTES[palette % PLAYER_PALETTES.length];
  const o = outfit ? OUTFITS[costume] : null;
  const col = (v) => (v === "skin" ? skinColor : v);

  // --- legs ---
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 4, 10), mat(col(o?.legs) ?? pal.secondary, { rough: 0.7 }));
    leg.position.set(0.13 * s, 0.28, 0);
    root.add(leg);
    legs.push(leg);
  }

  // --- body (egg torso) ---
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), mat(o?.body ?? pal.primary, { rough: 0.6 }));
  body.scale.y = 1.25;
  body.position.y = 0.72;
  root.add(body);

  // universal torso details — break up the solid color on EVERY costume.
  // Body = sphere r0.3 scaled y1.25 (center 0.72, semi-axis y 0.375), so the
  // xz surface radius at height y is sqrt(0.3² − ((y−0.72)/1.25)²) — the /1.25
  // matters: without it pieces sink into the fatter ellipsoid and vanish.
  const surf = (y) => Math.sqrt(0.09 - ((y - 0.72) / 1.25) ** 2);
  const hasArmor = !!o?.armor;

  // chest emblem: thin cream disc sticker, proud of the belly front (z+) —
  // skipped for viking (armor chest plate IS the chest detail) and miner
  // (white body: a cream sticker is invisible, the suspenders break it up)
  if (!hasArmor && o?.body !== 0xf7f6ff) {
    const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 20), mat(0xf7f6ff, { rough: 0.5 }));
    emblem.rotation.x = Math.PI / 2; // face forward
    emblem.position.set(0, 0.85, surf(0.85) + 0.005);
    root.add(emblem);
  }

  // belt: thin dark cylinder at the belly/pants boundary — skipped where a
  // costume-specific waist piece already draws the line (hero amber belt,
  // viking skirt, bunny hoodie pouch)
  if (!hasArmor && costume !== "hero" && costume !== "bunny") {
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(surf(0.52) + 0.01, surf(0.52) + 0.01, 0.07, 20), mat(0x2a2038, { rough: 0.6 }));
    belt.position.y = 0.52;
    root.add(belt);
  }

  // collar: snug white torus ringing the neck seam — body top (y1.095) has
  // surface radius ~0.08, so the ring must stay small (r0.11, tube 0.05) or it
  // floats off the chest — skipped for frog, whose DRESS collar is the identity
  if (costume !== "frog") {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.05, 10, 24), mat(0xf7f6ff, { rough: 0.6 }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.07;
    root.add(collar);
  }

  // buttons: two cream dots down the front between emblem and belt — skipped
  // for bunny (zipper), hero (belt zone), viking (armor)
  if (!hasArmor && costume !== "bunny" && costume !== "hero") {
    for (const by of [0.6, 0.68]) {
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), mat(0xf7f6ff, { rough: 0.4 }));
      btn.position.set(0, by, surf(by) + 0.008);
      root.add(btn);
    }
  }

  // --- arms (stubby, A-pose) ---
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 10), mat(col(o?.arms) ?? o?.body ?? pal.primary, { rough: 0.6 }));
    arm.position.set(0.33 * s, 0.78, 0);
    arm.rotation.z = s * 0.5;
    root.add(arm);
    arms.push(arm);
    // hand
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(col(o?.gloves) ?? skinColor, { rough: 0.65 }));
    if (o?.gloves) hand.scale.setScalar(1.35);
    hand.position.set(0.42 * s, 0.62, 0);
    root.add(hand);
    if (s > 0) {
      root.userData.rightArm = arm;  // prop swings with pose() arm swings
      root.userData.rightHand = hand; // static anchor on the palm itself
    }
  }

  // --- outfit extras (shoes / armor plates / clothing details) ---
  if (o) {
    for (const s of [-1, 1]) {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.22), mat(o.shoes ?? 0x2a2038, { rough: 0.7 }));
      shoe.position.set(0.13 * s, 0.05, 0.02);
      root.add(shoe);
    }
    if (o.armor) {
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.62), mat(0x8d93a1, { rough: 0.5, metal: 0.3 }));
      chest.position.y = 0.75;
      root.add(chest);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.4), mat(0x8d93a1, { rough: 0.5, metal: 0.3 }));
      skirt.position.y = 0.47;
      root.add(skirt);
    }
    DRESS[costume]?.({ root, legs, arms, body, surf });
  }

  // --- head: oversized, ~50% of total height (reference proportion) ---
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), mat(skinColor, { rough: 0.55 }));
  head.position.y = 1.42;
  root.add(head);

  // ears
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(skinColor, { rough: 0.55 }));
    ear.position.set(0.4 * s, 1.42, 0);
    root.add(ear);
  }

  // --- face (z+ front) ---
  const face = buildFace(head, skinColor);
  root.add(face);
  root.userData.face = face;

  // --- hat/costume ---
  const hatRoot = new THREE.Group();
  hatRoot.position.y = 1.42;
  root.add(hatRoot);
  HATS[costume]?.(hatRoot, pal);

  // --- carrier state helpers (design.md §2: red contour + bomb glyph handled by game layer) ---
  root.userData.head = head;
  root.userData.hatRoot = hatRoot;
  root.userData.palette = pal;

  // overhead nameplate + bomb glyph anchors (design.md §2 remote players / holder)
  const plate = new THREE.Group();
  plate.position.y = 2.25;
  root.add(plate);
  root.userData.nameplate = plate;
  root.userData.bombGlyph = null; // game layer attaches glyph mesh here
  root.userData.setBombGlyph = (mesh) => {
    if (root.userData.bombGlyph) plate.remove(root.userData.bombGlyph);
    root.userData.bombGlyph = mesh;
    if (mesh) plate.add(mesh);
  };

  // idle bob + face hooks
  root.userData.tick = (t) => {
    root.position.y = Math.sin(t * 2 + root.userData.bobSeed) * 0.02;
  };
  root.userData.bobSeed = Math.random() * Math.PI * 2;

  // movement pose — gait phase integrates with actual stride, wall-clock t only
  // anchors it when idle. Walk: knees step along the capsule axis, arms counter-
  // swing, slight torso lean. Sprint: faster, wider swing + deep forward lean +
  // vertical bounce (the capsule legs read as running, not just faster walking).
  let phase = 0;
  root.userData.pose = ({ moving = false, sprinting = false }, t, dt = 0) => {
    if (moving) {
      phase += (sprinting ? 13.5 : 7.5) * dt; // stride rate follows the real gait
      if (phase > Math.PI * 2) phase -= Math.PI * 2;
    }
    const s = Math.sin(phase);

    if (moving && sprinting) {
      // run: thigh-length strokes on a leaning torso, arms pump hard
      legs[0].rotation.x = -s * 0.95 - 0.15;
      legs[1].rotation.x = s * 0.95 - 0.15;
      arms[0].rotation.x = s * 0.9 - 0.4;  // elbows pumped up front
      arms[1].rotation.x = -s * 0.9 - 0.4;
      body.rotation.x = 0.28;
      root.position.y = Math.abs(Math.sin(phase)) * 0.09 + Math.sin(t * 2 + root.userData.bobSeed) * 0.01;
    } else if (moving) {
      // walk: gentle alternate steps, arms swing lightly opposite the legs
      legs[0].rotation.x = -s * 0.55;
      legs[1].rotation.x = s * 0.55;
      arms[0].rotation.x = s * 0.4;
      arms[1].rotation.x = -s * 0.4;
      body.rotation.x = 0.06;
      root.position.y = Math.abs(Math.sin(phase)) * 0.035 + Math.sin(t * 2 + root.userData.bobSeed) * 0.01;
    } else {
      // idle: settle back to standing (phase eases to 0 so it never mid-step-freezes)
      phase *= Math.exp(-8 * dt);
      const e = Math.sin(phase) * Math.exp(-6 * dt * 10);
      legs[0].rotation.x = -e * 0.4; legs[1].rotation.x = e * 0.4;
      arms[0].rotation.x = e * 0.3; arms[1].rotation.x = -e * 0.3;
      body.rotation.x = 0;
      root.position.y = Math.sin(t * 2 + root.userData.bobSeed) * 0.02;
    }
  };

  // every mesh casts + receives so the chibi volume reads under a key light
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return root;
}

// ---------------------------------------------------------------
// Face — dot eyes, brows, mouth on a small plane group hugging the head
// ---------------------------------------------------------------
function buildFace(head, skinColor) {
  const face = new THREE.Group();
  // pushed forward + slightly lowered so hat shells (miner shades r0.435,
  // hero mask) never clip brows/eyes: brow tops sit at y 1.56, deepest hat
  // shells now end above that line
  face.position.set(0, 1.38, 0.415);

  const eyeGeo = new THREE.SphereGeometry(0.045, 8, 6);
  const black = mat(0x2a2038, { rough: 0.4 });

  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, black);
    eye.position.set(0.14 * s, 0.05, 0);
    face.add(eye);
    eyes.push(eye);
  }

  const brows = [];
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.05), black);
    brow.position.set(0.14 * s, 0.14, 0);
    face.add(brow);
    brows.push(brow);
  }

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.05), black);
  mouth.position.set(0, -0.1, 0.01);
  face.add(mouth);

  const blink = { t: 0, next: 1 + Math.random() * 3 };
  face.userData.express = (name = "idle", t = 0) => {
    switch (name) {
      case "happy": // closed happy arc eyes + big smile
        eyes.forEach((e) => (e.scale.y = 0.1));
        brows.forEach((b) => (b.rotation.z = -0.2));
        mouth.scale.set(1.3, 1.4, 1);
        break;
      case "panic": // wide eyes, high brows, O mouth
        eyes.forEach((e) => (e.scale.set(1.2, 1.2, 1)));
        brows.forEach((b) => (b.position.y = 0.18));
        mouth.scale.set(0.8, 2.2, 1);
        break;
      case "sad":
        eyes.forEach((e) => (e.scale.y = 0.6));
        brows.forEach((b, i) => (b.rotation.z = i ? 0.35 : -0.35));
        mouth.scale.set(0.9, 0.6, 1);
        break;
      case "dizzy": // X squint, flat mouth
        eyes.forEach((e) => (e.scale.set(1.1, 0.15, 1)));
        mouth.scale.set(1, 0.5, 1);
        break;
      case "angry":
        brows.forEach((b, i) => (b.rotation.z = i ? -0.45 : 0.45));
        brows.forEach((b) => (b.position.y = 0.12));
        mouth.scale.set(1.1, 0.5, 1);
        break;
      default: // idle
        eyes.forEach((e) => e.scale.set(1, 1, 1));
        brows.forEach((b, i) => {
          b.rotation.z = 0;
          b.position.y = 0.14;
        });
        mouth.scale.set(1, 1, 1);
    }
    face.userData._expr = name;
  };

  // auto-blink when idle
  face.userData.tick = (t) => {
    if (face.userData._expr !== "idle") return;
    if (t > blink.next) {
      eyes.forEach((e) => (e.scale.y = 0.08));
      if (t > blink.next + 0.15) {
        eyes.forEach((e) => (e.scale.y = 1));
        blink.next = t + 1.5 + Math.random() * 3;
      }
    }
  };

  return face;
}

// ---------------------------------------------------------------
// HATS — the 10 costume variants from the reference roster.
// Each receives (group anchored at head center, player palette).
// ---------------------------------------------------------------
export const HATS = {
  frog(g, pal) {
    // green bucket hat with two dome eyes on top
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x7ed957, { rough: 0.6 }));
    g.add(dome);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.09, 8, 24), mat(0x7ed957, { rough: 0.6 }));
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.02;
    g.add(brim);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xffffff, { rough: 0.4 }));
      eye.position.set(0.18 * s, 0.34, 0.14);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(0x2a2038, { rough: 0.4 }));
      pupil.position.set(0.18 * s, 0.36, 0.24);
      g.add(pupil);
    }
  },

  chicken(g, pal) {
    // orange hood + red comb + beak
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(0xf6a04d, { rough: 0.6 }));
    g.add(hood);
    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0xe64533, { rough: 0.55 }));
    comb.position.set(0, 0.44, 0.05);
    comb.scale.y = 1.4;
    g.add(comb);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 10), mat(0xf6bd67, { rough: 0.5 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.05, 0.44);
    g.add(beak);
  },

  miner(g, pal) {
    // orange hard hat + headlamp
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0xf68b2c, { rough: 0.5 }));
    g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 24), mat(0xf68b2c, { rough: 0.5 }));
    brim.position.y = 0.02;
    g.add(brim);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12), mat(0xf7f6ff, { rough: 0.3, emissive: 0xfff2c2 }));
    lamp.position.set(0, 0.22, 0.4);
    g.add(lamp);
    // chunky green shades across the eyes (reference lineup) — radius 0.425
    // hugs the head (0.42) so the shell face ends proud of, not over, the brows
    const shades = new THREE.Mesh(new THREE.SphereGeometry(0.425, 20, 12, 0, Math.PI, Math.PI * 0.42, Math.PI * 0.16), mat(0x7ed957, { rough: 0.35 }));
    g.add(shades);
  },

  viking(g, pal) {
    // grey horned helmet + face guard
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), mat(0xb9bec9, { rough: 0.45, metal: 0.35 }));
    g.add(dome);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 10), mat(0xf2ede4, { rough: 0.6 }));
      horn.position.set(0.32 * s, 0.28, 0);
      horn.rotation.z = s * -0.5;
      g.add(horn);
    }
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42), mat(0x8d93a1, { rough: 0.5, metal: 0.35 }));
    guard.position.set(0, -0.3, 0.06);
    g.add(guard);
  },

  crab(g, pal) {
    // orange crab hat: dome + two claw stalks with eyes + pink shades (reference lineup)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf6a04d, { rough: 0.6 }));
    g.add(dome);
    for (const s of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 8), mat(0xf6a04d, { rough: 0.6 }));
      stalk.position.set(0.16 * s, 0.45, 0.1);
      g.add(stalk);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(0xffffff, { rough: 0.4 }));
      eye.position.set(0.16 * s, 0.58, 0.1);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(0x2a2038, { rough: 0.4 }));
      pupil.position.set(0.16 * s, 0.6, 0.18);
      g.add(pupil);
      // claw
      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0xf6a04d, { rough: 0.6 }));
      claw.position.set(0.34 * s, 0.42, 0);
      claw.scale.set(1, 0.7, 0.6);
      g.add(claw);
    }
    // chunky pink shades across the eyes (reference lineup) — same hug-fit as miner
    const shades = new THREE.Mesh(new THREE.SphereGeometry(0.425, 20, 12, 0, Math.PI, Math.PI * 0.42, Math.PI * 0.16), mat(0xf2a7c3, { rough: 0.35, emissive: 0xfbd3e2, emissiveIntensity: 0.25 }));
    g.add(shades);
  },

  bunny(g, pal) {
    // pink hood + tall ears
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(0xf2a7c3, { rough: 0.6 }));
    g.add(hood);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 4, 10), mat(0xf2a7c3, { rough: 0.6 }));
      ear.position.set(0.18 * s, 0.52, -0.05);
      ear.rotation.z = s * 0.15;
      g.add(ear);
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 4, 10), mat(0xfbd3e2, { rough: 0.6 }));
      inner.position.set(0.18 * s, 0.52, 0.02);
      inner.rotation.z = s * 0.15;
      g.add(inner);
    }
  },

  pirate(g, pal) {
    // brown tricorn + gold trim + red bandana knot
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(0x7a5236, { rough: 0.7 }));
    g.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.07, 24), mat(0x7a5236, { rough: 0.7 }));
    brim.position.y = 0.0;
    brim.scale.y = 1;
    g.add(brim);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 24), mat(0xf6bd67, { rough: 0.4 }));
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.05;
    g.add(trim);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0xe64533, { rough: 0.6 }));
    knot.position.set(0, 0.05, -0.42);
    knot.scale.z = 0.7;
    g.add(knot);
  },

  ninja(g, pal) {
    // pink bunny-ear beanie + grey hair side-locks + black face mask
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.16, 20), mat(0xf2a7c3, { rough: 0.6 }));
    band.position.y = 0.18;
    g.add(band);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 10), mat(0xf2a7c3, { rough: 0.6 }));
      ear.position.set(0.2 * s, 0.45, 0);
      ear.rotation.z = s * 0.2;
      g.add(ear);
    }
    // hair locks poking out
    for (const s of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x9aa0a8, { rough: 0.9 }));
      lock.position.set(0.36 * s, 0.02, 0);
      lock.scale.set(0.6, 1.3, 0.8);
      g.add(lock);
    }
    // face mask: front half (phi 0..π covers z≥0), lower-latitude band
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.43, 16, 12, 0, Math.PI, Math.PI * 0.52, Math.PI * 0.3), mat(0x2a2038, { rough: 0.7 }));
    g.add(mask);
  },

  glasses3d(g, pal) {
    // white-framed 3D glasses with blue/red lenses + black afro-puff
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mat(0x2a2038, { rough: 0.9 }));
    puff.position.set(0, 0.28, -0.08);
    puff.scale.y = 0.7;
    g.add(puff);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.1), mat(0xf7f6ff, { rough: 0.4 }));
    frame.position.set(0, 0.05, 0.4);
    g.add(frame);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.02), mat(0x63e8f2, { rough: 0.2, emissive: 0x63e8f2 }));
    blue.position.set(-0.14, 0.05, 0.46);
    g.add(blue);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.02), mat(0xff667e, { rough: 0.2, emissive: 0xff667e }));
    red.position.set(0.14, 0.05, 0.46);
    g.add(red);
  },

  hero(g, pal) {
    // superhero: green domino mask band across the eyes (front half) — narrowed
    // latitude band + r0.425 so brows stay clear
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.425, 20, 14, 0, Math.PI, Math.PI * 0.36, Math.PI * 0.2), mat(0x7ed957, { rough: 0.5 }));
    g.add(mask);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.03), mat(0xf7f6ff, { rough: 0.2, emissive: 0xf7f6ff }));
      eye.position.set(0.15 * s, 0.05, 0.42);
      eye.rotation.z = s * -0.25;
      g.add(eye);
    }
  },
};

// BombTargetIndicator (design.md §9) — ground ring under the nearest passable
// player; game layer positions it each frame (server PASS_RANGE = 1.8 u).
export function createTargetRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.7, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.userData.tick = (t) => {
    const p = 0.5 + 0.5 * Math.sin(t * 8);
    ring.scale.setScalar(1 + 0.12 * p);
    ring.material.opacity = 0.55 + 0.35 * p;
  };
  return ring;
}

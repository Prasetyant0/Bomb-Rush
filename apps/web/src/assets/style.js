// Shared palette + toy material factory for all BOMB RUSH 3D assets.
// Colors come from docs/spec/design.md §1.
import * as THREE from "three";

export const PALETTE = {
  bg: 0x111024,
  panel: 0x211a39,
  primary: 0x8367ef,
  lavender: 0xb9a7ff,
  cyan: 0x63e8f2,
  coral: 0xff667e,
  amber: 0xf6bd67,
  white: 0xf7f6ff,
};

// The 4 player palettes — lobby seats and arena colors must use these exact values
// (design.md §8: no lobby/arena color inconsistency).
export const PLAYER_PALETTES = [
  { name: "VOLT", primary: 0x8367ef, secondary: 0x5a48b8, accent: 0xb9a7ff },
  { name: "JET", primary: 0x63e8f2, secondary: 0x2e9aa6, accent: 0xc9fbff },
  { name: "BLAZE", primary: 0xff667e, secondary: 0xb84a5c, accent: 0xffb3be },
  { name: "SUNNY", primary: 0xf6bd67, secondary: 0xb98a3a, accent: 0xffe3ae },
];

// 5 skin tones, pale → dark, matching the reference sheet.
export const SKIN_TONES = [0xffe0c2, 0xe8b98a, 0xc68863, 0x8d5a3a, 0x5c3a24];

const cache = new Map();

// ponytail: global material cache — fine at ~4 players × ~6 colors; re-key per scene if instancing hundreds.
export function mat(color, { rough = 0.6, metal = 0, emissive = 0, flat = false } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${flat}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: metal,
        emissive,
        emissiveIntensity: emissive ? 1 : 0,
        flatShading: flat,
      }),
    );
  }
  return cache.get(key);
}

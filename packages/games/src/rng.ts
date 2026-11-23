// mulberry32. The generator state lives in the game state so a run can be replayed from its seed.
export interface Seeded {
  seed: number;
}

/** Next float in [0, 1). */
export function rnd(s: Seeded): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Float in [a, b), like the prototype's R(a, b). */
export const R = (s: Seeded, a: number, b: number): number => a + rnd(s) * (b - a);

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Normalises any integer to a 32-bit seed. */
export const toSeed = (n: number): number => n | 0;

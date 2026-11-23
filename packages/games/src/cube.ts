// Cube Field. Port of the prototype's DEF.cube; the Three.js view is apps/web/src/game3d/cube.ts.
import { R } from './rng';
import { W } from './types';
import type { BaseState, GameDef } from './types';

/** Centre of a 2x2x2 cube on the ground plane. The array index also picks its colour in the view. */
export interface CubeObstacle {
  x: number;
  z: number;
}

export interface CubeState extends BaseState {
  /** Ship x (the ship stays at z = 0; the field moves towards it). */
  x: number;
  vx: number;
  /** Distance flown; the view scrolls the grid from it. */
  dist: number;
  cubes: CubeObstacle[];
}

export const CUBE_COUNT = 70;

export const cube: GameDef<CubeState> = {
  key: 'cube',
  version: 1,
  gl: true,
  // score = floor(dist / 3), dist(T) = 30T + 0.55T(T + dt), so score / T <= 10 + 0.18334(T + dt): 120.01 at T = 600 s.
  // The bound is valid for runs up to 600 s; speed grows without limit, so no constant covers every duration.
  maxScorePerSecond: 121,
  scoreSlack: 0,

  init(seed) {
    const s: CubeState = { score: 0, t: 0, seed, fx: [], x: 0, vx: 0, dist: 0, cubes: [] };
    for (let i = 0; i < CUBE_COUNT; i++) s.cubes.push({ x: R(s, -45, 45), z: -40 - i * 1.7 });
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    let a = 0;
    if (input.l || (input.ptr && input.px < W / 2)) a = -1;
    if (input.r || (input.ptr && input.px >= W / 2)) a = 1;
    s.vx += (a * 22 - s.vx) * Math.min(1, dt * 7);
    s.x += s.vx * dt;

    const v = 30 + s.t * 1.1;
    s.dist += v * dt;
    s.score = Math.floor(s.dist / 3);

    for (const c of s.cubes) {
      c.z += v * dt;
      if (c.z > 8) {
        c.z -= R(s, 118, 128);
        c.x = s.x + R(s, -48, 48);
      }
      if (Math.abs(c.z) < 1.5 && Math.abs(c.x - s.x) < 1.45) return true;
    }
    return false;
  },
};

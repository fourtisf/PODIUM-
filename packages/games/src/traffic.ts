// Traffic Rush. Port of the prototype's DEF.traffic; the Three.js view is apps/web/src/game3d/traffic.ts.
import { rnd } from './rng';
import type { BaseState, GameDef } from './types';

/** One slot of the 14-car pool. The slot index also picks the car's colour in the view. */
export interface TrafficCar {
  on: boolean;
  /** World x: -3, 0 or 3 (lane centre). */
  x: number;
  /** World z; the player sits at 0 and cars spawn at -100. */
  z: number;
  /** The car's own forward speed. */
  v: number;
}

export interface TrafficState extends BaseState {
  /** Target lane 0..2. */
  lane: number;
  /** Player x, easing towards the lane centre. */
  px: number;
  /** Seconds until the next spawn. */
  sp: number;
  /** Distance driven; the view scrolls road lines and buildings from it. */
  dist: number;
  cars: TrafficCar[];
}

export const TRAFFIC_POOL = 14;

export const traffic: GameDef<TrafficState> = {
  key: 'traffic',
  version: 1,
  gl: true,
  // score = floor(dist / 4), dist(T) = 22T + 0.45T(T + dt), so score / T <= 5.5 + 0.1125(T + dt): 73.01 at T = 600 s.
  // The bound is valid for runs up to 600 s; speed grows without limit, so no constant covers every duration.
  maxScorePerSecond: 74,
  scoreSlack: 0,

  init(seed) {
    const cars: TrafficCar[] = [];
    for (let i = 0; i < TRAFFIC_POOL; i++) cars.push({ on: false, x: 0, z: 0, v: 0 });
    return { score: 0, t: 0, seed, fx: [], lane: 1, px: 0, sp: 0.6, dist: 0, cars };
  },

  update(s, input, dt) {
    s.t += dt;
    for (const q of input.presses) {
      if (q === 'l') s.lane = Math.max(0, s.lane - 1);
      if (q === 'r') s.lane = Math.min(2, s.lane + 1);
    }
    const tx = (s.lane - 1) * 3;
    s.px += (tx - s.px) * Math.min(1, dt * 14);

    const v = 22 + s.t * 0.9;
    s.dist += v * dt;
    s.score = Math.floor(s.dist / 4);

    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = Math.max(0.34, 1 - s.t * 0.011);
      const c = s.cars.find((c) => !c.on);
      if (c) {
        c.on = true;
        c.x = (Math.floor(rnd(s) * 3) - 1) * 3;
        c.z = -100;
        c.v = 8 + rnd(s) * 7;
      }
    }

    for (const c of s.cars) {
      if (!c.on) continue;
      c.z += (v - c.v) * dt;
      if (c.z > 14) c.on = false;
      else if (Math.abs(c.z) < 3.3 && Math.abs(c.x - s.px) < 1.65) return true;
    }
    return false;
  },
};

// Traffic Rush. Port of the prototype's DEF.traffic; the Three.js view is apps/web/src/game3d/traffic.ts.
import { ramp } from './pace';
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

/** Road speed in world units per second (version 2 pacing). Display code uses it for camera effects. */
export const trafficSpeed = (t: number): number => 22 + ramp(t, 10, 40) * 0.9;

export const traffic: GameDef<TrafficState> = {
  key: 'traffic',
  version: 2,
  gl: true,
  // score = floor(dist / 4), dist(T) = 22T + 0.45T(T + dt), so score / T <= 5.5 + 0.1125(T + dt): 73.01 at T = 600 s.
  // The bound is valid for runs up to 600 s; speed grows without limit, so no constant covers every duration.
  // Version 2 adds 0.9 * (10 - t / 4) to the speed for t < 40 s: at most 180 more distance (45 points) in a run,
  // so the ratio at 600 s becomes 73.08 (simulated at 60 Hz), still under 74.
  maxScorePerSecond: 74,
  scoreSlack: 0,

  init(seed) {
    const cars: TrafficCar[] = [];
    for (let i = 0; i < TRAFFIC_POOL; i++) cars.push({ on: false, x: 0, z: 0, v: 0 });
    const s: TrafficState = { score: 0, t: 0, seed, fx: [], lane: 1, px: 0, sp: 0.6, dist: 0, cars };
    // Version 2: three cars are already on the road, 22 units apart (never two abreast).
    for (let i = 0; i < 3; i++) {
      const c = cars[i]!;
      c.on = true;
      c.x = (Math.floor(rnd(s) * 3) - 1) * 3;
      c.z = -34 - i * 22;
      c.v = 8 + rnd(s) * 7;
    }
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    for (const q of input.presses) {
      if (q === 'l') s.lane = Math.max(0, s.lane - 1);
      if (q === 'r') s.lane = Math.min(2, s.lane + 1);
    }
    const tx = (s.lane - 1) * 3;
    s.px += (tx - s.px) * Math.min(1, dt * 14);

    // Version 2: the difficulty clock opens at 10 s and rejoins real time at 40 s.
    const e = ramp(s.t, 10, 40);
    const v = 22 + e * 0.9; // = trafficSpeed(s.t)
    s.dist += v * dt;
    s.score = Math.floor(s.dist / 4);

    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = Math.max(0.34, 1 - e * 0.011);
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

  view(s) {
    const v = trafficSpeed(s.t);
    let danger = 0;
    for (const c of s.cars) if (c.on && Math.abs(c.x - s.px) < 2 && c.z < 0 && c.z > -16) danger = Math.max(danger, 1 + c.z / 16);
    return { danger, speed: Math.min(1, (v - 24) / 46), stats: [{ k: 'speed', v: Math.round(v * 3.6) }] };
  },
};

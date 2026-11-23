import { describe, expect, it } from 'vitest';
import { traffic } from '../src/traffic';
import type { Input } from '../src/types';
import { checkDeterministic } from './helpers';

const idle = (): Input => ({ l: false, r: false, ptr: false, px: 240, presses: [] });

describe('traffic', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(traffic));

  it('scores a point for every 4 units driven', () => {
    const s = traffic.init(3);
    for (let f = 0; f < 120; f++) {
      if (traffic.update(s, idle(), 1 / 60)) break;
      expect(s.score).toBe(Math.floor(s.dist / 4));
    }
    expect(s.dist).toBeGreaterThan(0);
  });

  it('a run with no input eventually crashes into a car in the same lane', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = traffic.init(seed);
      let dead = false;
      for (let f = 0; f < 60 * 120 && !dead; f++) dead = traffic.update(s, idle(), 1 / 60);
      expect(dead).toBe(true);
      expect(s.cars.some((c) => c.on && Math.abs(c.z) < 3.3 && Math.abs(c.x - s.px) < 1.65)).toBe(true);
      expect(s.score).toBe(Math.floor(s.dist / 4));
    }
  });

  it('lane presses move the car between the three lanes and stop at the edges', () => {
    const s = traffic.init(1);
    traffic.update(s, { ...idle(), presses: ['l', 'l', 'l'] }, 1 / 60);
    expect(s.lane).toBe(0);
    expect(s.px).toBeLessThan(0);
    traffic.update(s, { ...idle(), presses: ['r', 'r', 'r', 'r'] }, 1 / 60);
    expect(s.lane).toBe(2);
  });
});

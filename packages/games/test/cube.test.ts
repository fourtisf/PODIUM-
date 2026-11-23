import { describe, expect, it } from 'vitest';
import { cube } from '../src/cube';
import type { Input } from '../src/types';
import { checkDeterministic } from './helpers';

const idle = (): Input => ({ l: false, r: false, ptr: false, px: 240, presses: [] });

describe('cube', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(cube));

  it('scores a point for every 3 units flown', () => {
    const s = cube.init(9);
    for (let f = 0; f < 60 * 20; f++) {
      if (cube.update(s, idle(), 1 / 60)) break;
      expect(s.score).toBe(Math.floor(s.dist / 3));
    }
    expect(s.score).toBeGreaterThan(0);
  });

  it('steers with held keys and with the pointer half', () => {
    const a = cube.init(1);
    cube.update(a, { ...idle(), l: true }, 1 / 60);
    expect(a.x).toBeLessThan(0);
    const b = cube.init(1);
    cube.update(b, { ...idle(), ptr: true, px: 400 }, 1 / 60);
    expect(b.x).toBeGreaterThan(0);
  });

  it('ends the run when a cube reaches the ship', () => {
    const s = cube.init(1);
    s.cubes[0] = { x: 0, z: -3 };
    let dead = false;
    for (let f = 0; f < 30 && !dead; f++) dead = cube.update(s, idle(), 1 / 60);
    expect(dead).toBe(true);
  });

  it('different seeds lay out different fields', () => {
    expect(cube.init(1).cubes).not.toEqual(cube.init(2).cubes);
  });
});

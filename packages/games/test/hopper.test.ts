import { describe, expect, it } from 'vitest';
import { hopper } from '../src/hopper';
import type { Input, Press } from '../src/types';
import { checkDeterministic } from './helpers';

const input = (...presses: Press[]): Input => ({ l: false, r: false, ptr: false, px: 240, presses });
const DT = 1 / 60;

describe('hopper', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(hopper));

  it('each forward hop raises the score by one row', () => {
    for (const seed of [1, 2, 3, 99]) {
      const s = hopper.init(seed);
      // Rows 1 and 2 are always open grass; a hop takes 8 steps.
      for (let f = 0; f < 8; f++) expect(hopper.update(s, input(...(f === 0 ? ['a' as const] : [])), DT)).toBe(false);
      expect(s.row).toBe(1);
      expect(s.score).toBe(1);
      for (let f = 0; f < 8; f++) expect(hopper.update(s, input(...(f === 0 ? ['a' as const] : [])), DT)).toBe(false);
      expect(s.row).toBe(2);
      expect(s.score).toBe(2);
    }
  });

  it('sideways hops do not score and stop at the edge of the field', () => {
    const s = hopper.init(5);
    for (let f = 0; f < 200; f++) hopper.update(s, input('l'), DT);
    expect(s.x).toBe(-8);
    expect(s.score).toBe(0);
  });

  it('the camera waits for the first hop, then leaves an idle player behind', () => {
    const s = hopper.init(7);
    for (let f = 0; f < 60 * 30; f++) expect(hopper.update(s, input(), DT)).toBe(false);
    expect(s.cam).toBe(0);

    hopper.update(s, input('a'), DT);
    let dead = false;
    let f = 0;
    for (; f < 60 * 60 && !dead; f++) dead = hopper.update(s, input(), DT);
    expect(dead).toBe(true);
    expect(s.row).toBe(1);
    expect(s.row * 2).toBeLessThan(s.cam - 7.5);
    expect(f).toBeGreaterThan(60 * 5);
  });

  it('different seeds give different rows', () => {
    const a = hopper.init(1).rows;
    const b = hopper.init(2).rows;
    expect(a.map((r) => r.r)).toEqual(b.map((r) => r.r));
    expect(a).not.toEqual(b);
    expect(hopper.init(1).rows).toEqual(a);
  });

  it('rows stay contiguous and the first rows are safe grass', () => {
    const s = hopper.init(11);
    expect(s.rows[0]!.r).toBe(-7);
    expect(s.rows.length).toBe(31);
    for (const row of s.rows) {
      if (row.r <= 3) expect(row.type).toBe('grass');
      if (row.r <= 2) expect(row.trees).toEqual([]);
    }
    for (let i = 1; i < s.rows.length; i++) expect(s.rows[i]!.r).toBe(s.rows[i - 1]!.r + 1);
  });
});

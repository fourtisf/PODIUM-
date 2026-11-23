import { describe, expect, it } from 'vitest';
import { blade } from '../src/blade';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('blade', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(blade));

  it('ends with no score when the first enemy reaches the player', () => {
    for (const seed of [1, 2, 3]) {
      const r = replay(blade, seed, [], 60 * 20);
      expect(r.dead).toBe(true);
      expect(r.score).toBe(0);
      // Spawn at 0.7 s, then 246 px at 95..133 px/s.
      expect(r.seconds).toBeGreaterThan(0.7 + 246 / 134);
      expect(r.seconds).toBeLessThan(0.75 + 246 / 95);
    }
  });

  it('a slash kills only an enemy within 125 px on that side; a miss costs a 0.42 s cooldown and the combo', () => {
    const run = new LiveRun(blade, 7);
    while (run.state.en.length === 0) run.step();
    const e = run.state.en[0]!;
    const right = e.side > 0;
    // Too far away: the slash misses.
    expect(e.d).toBeGreaterThan(125);
    run.push(right ? Ev.PRESS_R : Ev.PRESS_L);
    run.step();
    expect(run.state.score).toBe(0);
    expect(run.state.cd).toBeCloseTo(0.42, 9);
    expect(run.state.en.length).toBe(1);
    // Wait until it is in range (the cooldown has run out by then), then slash the correct side.
    while (run.state.en[0]!.d >= 125) run.step();
    expect(run.state.cd).toBe(0);
    run.push(right ? Ev.PRESS_R : Ev.PRESS_L);
    run.step();
    expect(run.state.score).toBe(1);
    expect(run.state.combo).toBe(1);
    expect(run.state.en.some((x) => x === e)).toBe(false);
  });

  it('every sixth kill in a row raises the points per kill', () => {
    const run = new LiveRun(blade, 11);
    let expected = 0, kills = 0;
    for (let f = 0; f < 60 * 40 && !run.dead && kills < 14; f++) {
      const near = run.state.en.find((e) => e.d < 120);
      if (near) {
        run.push(near.side > 0 ? Ev.PRESS_R : Ev.PRESS_L);
        kills++;
        expected += 1 + Math.floor(kills / 6);
      }
      run.step();
      expect(run.state.score).toBe(expected);
    }
    expect(kills).toBe(14);
    expect(run.state.score).toBe(5 * 1 + 6 * 2 + 3 * 3);
  });

  it('a different seed changes the run', () => {
    const ends = [1, 2, 3, 4, 5].map((seed) => replay(blade, seed, [], 60 * 20).frames);
    expect(new Set(ends).size).toBeGreaterThan(1);
  });
});

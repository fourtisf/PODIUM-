import { describe, expect, it } from 'vitest';
import { sprint } from '../src/sprint';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('sprint', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(sprint));

  it('runs into the first spike without a jump; score is distance / 20', () => {
    for (const seed of [1, 2, 3]) {
      const r = replay(sprint, seed, [], 600);
      expect(r.dead).toBe(true);
      // Spike appears at 1.1 s at x = 510 and reaches the runner (x < 123) at about 280 px/s.
      expect(r.seconds).toBeGreaterThan(2.3);
      expect(r.seconds).toBeLessThan(2.7);
      const dist = 270 * r.seconds + 4 * r.seconds ** 2;
      expect(Math.abs(r.score - dist / 20)).toBeLessThan(1.5);
    }
  });

  it('allows a double jump but not a third until landing', () => {
    const run = new LiveRun(sprint, 1);
    run.push(Ev.PRESS_A);
    run.step();
    expect(run.state.j).toBe(1);
    expect(run.state.vy).toBeCloseTo(-600 + 1750 / 60, 9);
    expect(run.state.y).toBeLessThan(0);
    run.push(Ev.PRESS_A);
    run.push(Ev.PRESS_A);
    const fx = run.step();
    expect(run.state.j).toBe(2);
    expect(fx.filter((e) => e.k === 'burst').length).toBe(1);
    run.push(Ev.PRESS_L);
    run.step();
    expect(run.state.vy).toBeCloseTo(-600 + 2 * (1750 / 60), 9);
    while (run.state.y < 0 && !run.dead) run.step();
    expect(run.state.j).toBe(0);
    expect(run.state.vy).toBe(0);
  });

  it('jumping the spikes keeps the run alive and coins add 10', () => {
    const run = new LiveRun(sprint, 2);
    let coins = 0;
    for (let f = 0; f < 60 * 15 && !run.dead; f++) {
      const s = run.state;
      const v = 270 + s.t * 8;
      // Jump when a spike is about 0.17 s away.
      if (s.y === 0 && s.obs.some((o) => o.x > 110 && o.x - 123 < v * 0.17)) run.push(Ev.PRESS_A);
      const fx = run.step();
      coins += fx.filter((e) => e.k === 'beep').length;
      expect(s.bonus).toBe(coins * 10);
    }
    expect(run.state.t).toBeGreaterThan(6);
    expect(run.score).toBe(Math.floor(run.state.dist / 20) + coins * 10);
  });

  it('a different seed changes the spikes', () => {
    const hs = [1, 2, 3].map((seed) => {
      const run = new LiveRun(sprint, seed);
      while (run.state.obs.length === 0) run.step();
      return run.state.obs[0]!.h;
    });
    expect(new Set(hs).size).toBe(3);
  });
});

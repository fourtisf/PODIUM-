import { describe, expect, it } from 'vitest';
import { duck } from '../src/duck';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('duck', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(duck));

  it('scores floor(t * 10) plus 15 per coin while alive', () => {
    for (const seed of [1, 2, 3]) {
      const run = new LiveRun(duck, seed);
      let coins = 0;
      for (let f = 0; f < 60 * 30 && !run.dead; f++) {
        // Sweep left and right so coins get picked up.
        if (f % 120 === 0) { run.push(Ev.R_UP); run.push(Ev.L_DOWN); }
        if (f % 120 === 60) { run.push(Ev.L_UP); run.push(Ev.R_DOWN); }
        const fx = run.step();
        coins += fx.filter((e) => e.k === 'burst').length;
        if (!run.dead) {
          expect(run.state.bonus).toBe(coins * 15);
          expect(run.state.score).toBe(Math.floor(run.state.t * 10) + run.state.bonus);
        }
      }
    }
  });

  it('moves at 300 px/s and stays inside the banks', () => {
    const run = new LiveRun(duck, 5);
    run.push(Ev.L_DOWN);
    run.step();
    expect(run.state.x).toBeCloseTo(240 - 300 / 60, 9);
    for (let f = 0; f < 50 && !run.dead; f++) run.step();
    expect(run.state.x).toBe(26);
  });

  it('logs come from the seed, so idle runs differ between seeds', () => {
    const frames = [1, 2, 3, 4, 5, 6].map((seed) => replay(duck, seed, [], 60 * 120));
    for (const r of frames) expect(r.dead).toBe(true);
    expect(new Set(frames.map((r) => r.frames)).size).toBeGreaterThan(1);
    // The first log appears after 0.4 s and needs over 2 s to drift down to the duck.
    for (const r of frames) expect(r.seconds).toBeGreaterThan(2.4);
  });
});

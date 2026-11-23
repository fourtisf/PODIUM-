import { describe, expect, it } from 'vitest';
import { hoop } from '../src/hoop';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('hoop', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(hoop));

  it('ends after exactly three misses', () => {
    // A shot takes 21 steps; at these times the hoop is well off centre.
    const log = [0, Ev.PRESS_A, 0, 21, Ev.PRESS_A, 0, 42, Ev.PRESS_A, 0];
    expect(replay(hoop, 1, log.slice(0, 6), 600)).toMatchObject({ dead: false, score: 0 });
    const r = replay(hoop, 1, log, 600);
    expect(r).toMatchObject({ dead: true, score: 0, frames: 63 });

    const run = new LiveRun(hoop, 1);
    const lives: number[] = [];
    for (let f = 0; f < 63; f++) {
      if (f % 21 === 0) run.push(Ev.PRESS_A);
      run.step();
      if (f % 21 === 20) lives.push(run.state.lives);
    }
    expect(lives).toEqual([2, 1, 0]);
    expect(run.dead).toBe(true);
  });

  it('scores a SWISH when the ball arrives while the hoop is over the centre', () => {
    // The hoop is back at the centre when the phase reaches pi: 1.5 rad/s, so step 126. Shoot 21 steps earlier.
    const run = new LiveRun(hoop, 1);
    for (let f = 0; f < 126; f++) {
      if (f === 105) run.push(Ev.PRESS_L);
      run.step();
    }
    expect(run.state.score).toBe(1);
    expect(run.state.lives).toBe(3);
    expect(run.state.msg).toBe('SWISH');
    expect(run.state.ball).toBeNull();
  });

  it('ignores presses while the ball is in the air and never ends without a shot', () => {
    const log: number[] = [];
    for (let f = 0; f < 21; f++) log.push(f, Ev.PRESS_A, 0);
    const r = replay(hoop, 1, log, 600);
    expect(r.dead).toBe(false); // one shot, one miss
    const run = new LiveRun(hoop, 1);
    for (let f = 0; f < 21; f++) { run.push(Ev.PRESS_A); run.step(); }
    expect(run.state.lives).toBe(2);
    expect(replay(hoop, 1, [], 3600).dead).toBe(false);
  });

  it('the hoop speeds up and narrows with the score', () => {
    const s = hoop.init(1);
    s.score = 10;
    hoop.update(s, { l: false, r: false, ptr: false, px: 240, presses: [] }, 1 / 60);
    expect(s.ph).toBeCloseTo((1.5 + 10 * 0.11) / 60, 12);
  });
});

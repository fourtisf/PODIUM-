import { describe, expect, it } from 'vitest';
import { glide } from '../src/glide';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('glide', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(glide));

  it('waits for the first tap', () => {
    const r = replay(glide, 1, [], 600);
    expect(r.dead).toBe(false);
    expect(r.score).toBe(0);
    const run = new LiveRun(glide, 1);
    for (let f = 0; f < 100; f++) run.step();
    expect(run.state.y).toBe(320);
    expect(run.state.gates.length).toBe(0);
  });

  it('a tap sets vy to -330 and gravity is 900', () => {
    const run = new LiveRun(glide, 1);
    run.push(Ev.PRESS_A);
    run.step();
    expect(run.state.vy).toBeCloseTo(-330 + 900 / 60, 9);
    expect(run.state.y).toBeCloseTo(320 + (-330 + 900 / 60) / 60, 9);
    expect(run.state.gates.length).toBe(1);
    expect(run.state.gates[0]!.gap).toBe(172);
  });

  // Flaps whenever the plane is below the centre of the next gate.
  function pilot(seed: number, maxFrames: number): LiveRun<ReturnType<typeof glide.init>> {
    const run = new LiveRun(glide, seed);
    run.push(Ev.PRESS_A);
    for (let f = 0; f < maxFrames && !run.dead; f++) {
      const g = run.state.gates.find((q) => q.x > 140 - 40);
      const target = g ? g.gy + 14 : 320;
      if (run.state.y > target && run.state.vy > -100) run.push(Ev.PRESS_A);
      run.step();
    }
    return run;
  }

  it('scores 1 per gate passed and 2 per star', () => {
    const run = pilot(3, 60 * 20);
    const s = run.state;
    expect(s.gp).toBeGreaterThanOrEqual(3);
    const stars = (s.score - s.gp) / 2;
    expect(Number.isInteger(stars)).toBe(true);
    expect(stars).toBeGreaterThanOrEqual(0);
    expect(stars).toBeLessThanOrEqual(s.gp + 1);
  });

  it('ends when the plane falls off the screen or hits a gate', () => {
    // One tap, then nothing: the first gate (2.2 s away) or the bottom edge ends the run within 2.5 s.
    for (const seed of [1, 2, 3, 4]) {
      const r = replay(glide, seed, [0, Ev.PRESS_A, 0], 600);
      expect(r.dead).toBe(true);
      expect(r.score).toBe(0);
      expect(r.frames).toBeGreaterThan(60);
      expect(r.frames).toBeLessThan(150);
    }
  });

  it('a different seed gives different gates', () => {
    const gy = [1, 2, 3].map((seed) => {
      const run = new LiveRun(glide, seed);
      run.push(Ev.PRESS_A);
      run.step();
      return run.state.gates[0]!.gy;
    });
    expect(new Set(gy).size).toBe(3);
    for (const y of gy) { expect(y).toBeGreaterThanOrEqual(170); expect(y).toBeLessThan(470); }
  });
});

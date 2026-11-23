import { describe, expect, it } from 'vitest';
import { stack } from '../src/stack';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('stack', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(stack));

  it('scores a floor on an overlapping drop and trims the overhang', () => {
    const run = new LiveRun(stack, 1);
    run.push(Ev.PRESS_A);
    run.step();
    // The block has moved 230 / 60 px from x = 0; it overlaps the base (140..340) on 140..203.83.
    const w = 230 / 60 + 200 - 140;
    expect(run.state.score).toBe(1);
    expect(run.state.blocks.length).toBe(2);
    expect(run.state.blocks[1]!.x).toBe(140);
    expect(run.state.blocks[1]!.w).toBeCloseTo(w, 9);
    // The next block starts from the right edge, moving left, with the trimmed width.
    expect(run.state.cur.dir).toBe(-1);
    expect(run.state.cur.w).toBeCloseTo(w, 9);
    expect(run.state.cur.x).toBeCloseTo(480 - w, 9);
  });

  it('ends the run on a drop that misses the tower', () => {
    const r = replay(stack, 1, [0, Ev.PRESS_A, 0, 1, Ev.PRESS_A, 0], 600);
    expect(r.dead).toBe(true);
    expect(r.frames).toBe(2);
    expect(r.score).toBe(1);
  });

  it('a drop within 7 px is PERFECT and keeps the full width', () => {
    const run = new LiveRun(stack, 1);
    // Press on the step that brings the block within 7 px of x = 140.
    const perStep = 230 / 60;
    let f = 0;
    while (Math.abs(run.state.cur.x + perStep - 140) >= 7) { run.step(); f++; }
    run.push(Ev.PRESS_A);
    run.step();
    expect(f).toBeGreaterThan(30);
    expect(run.state.score).toBe(1);
    expect(run.state.blocks[1]).toEqual({ x: 140, w: 200 });
    expect(run.state.flash).toBe(0.25);
    expect(run.state.cur).toEqual({ x: 280, w: 200, dir: -1 });
  });

  it('never ends without a press and the block bounces between the walls', () => {
    const run = new LiveRun(stack, 9);
    let min = Infinity, max = -Infinity;
    for (let f = 0; f < 600; f++) {
      run.step();
      min = Math.min(min, run.state.cur.x);
      max = Math.max(max, run.state.cur.x);
    }
    expect(run.dead).toBe(false);
    expect(min).toBe(0);
    expect(max).toBe(280);
  });
});

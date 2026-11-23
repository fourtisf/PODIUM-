import { describe, expect, it } from 'vitest';
import { breaker } from '../src/breaker';
import { Ev } from '../src/log';
import { LiveRun } from '../src/runner';
import { STEP, type Input } from '../src/types';
import { checkDeterministic } from './helpers';

const idle = (): Input => ({ l: false, r: false, ptr: false, px: 240, presses: [] });
const brick = (x: number, y: number, hp = 1) => ({ x, y, w: 53, h: 22, hp, r: 0, hit: 0 });

/** One brick straight above a ball flying up at it, plus a spare brick so the level does not clear. */
function aimed(combo: number, hp = 1) {
  const s = breaker.init(11);
  s.bricks = [brick(214, 300, hp), brick(14, 150)];
  s.balls = [{ x: 240, y: 340, vx: 0, vy: -341, stuck: 0 }];
  s.combo = combo;
  return s;
}

describe('breaker', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(breaker));

  it('starts with three lives, level 1 and a ball stuck to the paddle', () => {
    const s = breaker.init(1);
    expect(s).toMatchObject({ lives: 3, level: 1, px: 240, pw: 92, score: 0, t: 0, seed: 1, fx: [] });
    expect(s.balls).toEqual([{ x: 240, y: 575, vx: 0, vy: 0, stuck: 1 }]);
  });

  it('level layouts: 32 bricks, then a 20-brick checkerboard, then a 28-brick pyramid', () => {
    const s = breaker.init(1);
    expect(s.bricks).toHaveLength(32);
    expect(s.bricks.every((b) => b.hp === 1)).toBe(true);

    // Clearing a level pays 100 x level and builds the next one.
    s.bricks = [];
    breaker.update(s, idle(), STEP);
    expect(s.level).toBe(2);
    expect(s.score).toBe(100);
    expect(s.bricks).toHaveLength(20);
    expect(s.bricks.filter((b) => b.hp === 2)).toHaveLength(4); // top row is armoured from level 2

    s.bricks = [];
    breaker.update(s, idle(), STEP);
    expect(s.level).toBe(3);
    expect(s.score).toBe(100 + 200);
    expect(s.bricks).toHaveLength(28);
    expect(s.bricks.filter((b) => b.hp === 2)).toHaveLength(16); // top two rows
    expect([0, 1, 2, 3, 4].map((r) => s.bricks.filter((b) => b.r === r).length)).toEqual([8, 8, 6, 4, 2]);
  });

  it('launches on a press once the ball has sat for 0.2 s, or by itself after 1 s', () => {
    const early = new LiveRun(breaker, 3);
    early.push(Ev.PRESS_A);
    early.step();
    expect(early.state.balls[0]!.stuck).toBeGreaterThan(0); // too soon: the press is ignored

    const run = new LiveRun(breaker, 3);
    for (let i = 0; i < 20; i++) run.step();
    expect(run.state.balls[0]!.stuck).toBeGreaterThan(0);
    run.push(Ev.PRESS_A);
    run.step();
    const b = run.state.balls[0]!;
    expect(b.stuck).toBe(0);
    expect(b.vy).toBeLessThan(0);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(325 + 16, 6);

    const auto = new LiveRun(breaker, 3);
    for (let i = 0; i < 55; i++) auto.step();
    expect(auto.state.balls[0]!.stuck).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) auto.step();
    expect(auto.state.balls[0]!.stuck).toBe(0);
  });

  it('a brick is worth 10 points times the combo, capped at x8', () => {
    for (const [combo, pts] of [[0, 10], [1, 20], [3, 40], [7, 80], [30, 80]] as const) {
      const s = aimed(combo);
      for (let i = 0; i < 30 && s.bricks.length === 2; i++) breaker.update(s, idle(), STEP);
      expect(s.bricks).toHaveLength(1);
      expect(s.score).toBe(pts);
      expect(s.combo).toBe(combo + 1);
      expect(s.balls[0]!.vy).toBeGreaterThan(0); // bounced back down
    }
  });

  it('an armoured brick takes two hits and scores only when it breaks', () => {
    const s = aimed(0, 2);
    for (let i = 0; i < 30 && s.bricks[0]!.hp === 2; i++) breaker.update(s, idle(), STEP);
    expect(s.bricks[0]!.hp).toBe(1);
    expect(s.score).toBe(0);
    expect(s.combo).toBe(0);
  });

  it('the paddle returns the ball and resets the combo', () => {
    const s = breaker.init(4);
    s.combo = 5;
    s.balls = [{ x: 240, y: 570, vx: 0, vy: 341, stuck: 0 }];
    for (let i = 0; i < 10; i++) breaker.update(s, idle(), STEP);
    expect(s.combo).toBe(0);
    expect(s.balls[0]!.vy).toBeLessThan(0);
  });

  it('losing the last ball costs a life; the run ends on the third', () => {
    const s = breaker.init(2);
    s.combo = 4;
    s.balls = [];
    expect(breaker.update(s, idle(), STEP)).toBe(false);
    expect(s.lives).toBe(2);
    expect(s.combo).toBe(0);
    expect(s.balls).toHaveLength(1);
    expect(s.balls[0]!.stuck).toBeGreaterThan(0);
    s.balls = [];
    expect(breaker.update(s, idle(), STEP)).toBe(false);
    s.balls = [];
    expect(breaker.update(s, idle(), STEP)).toBe(true);
    expect(s.lives).toBe(0);
  });

  it('a ball that misses the paddle is lost', () => {
    const run = new LiveRun(breaker, 9);
    run.state.balls = [{ x: 420, y: 560, vx: 0, vy: 341, stuck: 0 }];
    for (let i = 0; i < 30; i++) run.step();
    expect(run.state.lives).toBe(2);
  });

  it('capsules: wide paddle, slow ball, extra life (max 5) and multi-ball (max 12)', () => {
    const s = breaker.init(6);
    s.balls = [{ x: 100, y: 400, vx: 0, vy: -341, stuck: 0 }];
    s.pu.push({ x: 240, y: 585, k: 'W' }, { x: 240, y: 585, k: 'S' }, { x: 240, y: 585, k: 'L' });
    breaker.update(s, idle(), STEP);
    expect(s.pu).toHaveLength(0);
    expect(s.wide).toBe(12);
    expect(s.slow).toBe(8);
    expect(s.lives).toBe(4);
    for (let i = 0; i < 60; i++) breaker.update(s, idle(), STEP);
    expect(s.pw).toBeGreaterThan(130);

    s.lives = 5;
    s.pu.push({ x: s.px, y: 585, k: 'L' });
    breaker.update(s, idle(), STEP);
    expect(s.lives).toBe(5);

    s.balls = [{ x: 100, y: 450, vx: 0, vy: -200, stuck: 0 }];
    for (const n of [3, 9, 12]) {
      s.pu.push({ x: s.px, y: 585, k: 'M' });
      breaker.update(s, idle(), STEP);
      expect(s.balls).toHaveLength(n);
    }
  });

  it('the paddle moves at 520 px/s with the keys and is clamped to the walls', () => {
    const run = new LiveRun(breaker, 5);
    run.push(Ev.R_DOWN);
    for (let i = 0; i < 6; i++) run.step();
    expect(run.state.px).toBeCloseTo(240 + 520 * 6 * STEP, 6);
    expect(run.state.balls[0]!.x).toBe(run.state.px); // the stuck ball rides the paddle
    for (let i = 0; i < 60; i++) run.step();
    expect(run.state.px).toBe(480 - 46 - 4);
  });

  it('different seeds launch at different angles', () => {
    const vx = (seed: number) => {
      const s = breaker.init(seed);
      for (let i = 0; i < 61; i++) breaker.update(s, idle(), STEP);
      return s.balls[0]!.vx;
    };
    expect(vx(1)).toBe(vx(1));
    expect(vx(1)).not.toBe(vx(2));
  });
});

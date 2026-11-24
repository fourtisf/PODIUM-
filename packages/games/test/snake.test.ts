import { describe, expect, it } from 'vitest';
import { snake } from '../src/snake';
import { snakeV1 } from '../src/snake.v1';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

describe('snake', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(snake));

  it('runs into the right wall after ten moves when left alone', () => {
    for (const seed of [1, 2, 3]) {
      const r = replay(snake, seed, [], 600);
      expect(r.dead).toBe(true);
      // Version 2: ten moves of 0.128 s (the speed of score 10), a little faster if food on the row was eaten.
      expect(r.frames).toBeGreaterThanOrEqual(72);
      expect(r.frames).toBeLessThanOrEqual(78);
      expect(r.score).toBeLessThanOrEqual(1);
      // Version 1 (archived): ten moves of 0.15 s.
      const v1 = replay(snakeV1, seed, [], 600);
      expect(v1.dead).toBe(true);
      expect(v1.frames).toBeGreaterThanOrEqual(85);
      expect(v1.frames).toBeLessThanOrEqual(101);
    }
  });

  it('version 1 (archived) is still deterministic', () => checkDeterministic(snakeV1));

  it('turns relative to the heading and queues at most two turns', () => {
    const run = new LiveRun(snake, 1);
    run.push(Ev.PRESS_R);
    run.push(Ev.PRESS_R);
    run.push(Ev.PRESS_L); // third turn is dropped
    run.push(Ev.PRESS_A); // not a turn
    run.step();
    expect(run.state.turns).toEqual(['r', 'r']);
    while (run.state.turns.length === 2) run.step();
    // Heading right, a right turn points down the screen.
    expect(run.state.dir.map((n) => n + 0)).toEqual([0, 1]);
    expect(run.state.body[0]).toEqual([10, 11]);
    while (run.state.turns.length === 1) run.step();
    expect(run.state.dir.map((n) => n + 0)).toEqual([-1, 0]);
    expect(run.state.body[0]).toEqual([9, 11]);
    expect(run.state.body.length).toBe(3);
  });

  it('eating the food scores, grows the snake and places new food on a free cell', () => {
    const run = new LiveRun(snake, 1);
    // Put the food straight ahead; state is plain data.
    run.state.food = [12, 10];
    while (run.state.score === 0 && !run.dead) run.step();
    expect(run.state.score).toBe(1);
    expect(run.state.body.length).toBe(4);
    expect(run.state.body[0]).toEqual([12, 10]);
    const [fx, fy] = run.state.food;
    expect(fx).toBeGreaterThanOrEqual(0);
    expect(fx).toBeLessThan(20);
    expect(fy).toBeGreaterThanOrEqual(0);
    expect(fy).toBeLessThan(20);
    expect(run.state.body.some((b) => b[0] === fx && b[1] === fy)).toBe(false);
  });

  it('ends when the snake bites itself', () => {
    const run = new LiveRun(snake, 1);
    run.state.body = [[10, 10], [9, 10], [8, 10], [7, 10], [6, 10]];
    run.state.food = [0, 0];
    for (let i = 0; i < 3 && !run.dead; i++) {
      run.push(Ev.PRESS_R);
      const head = run.state.body[0]!.join();
      while (!run.dead && run.state.body[0]!.join() === head) run.step();
    }
    expect(run.dead).toBe(true);
    expect(run.state.body[0]).toEqual([9, 11]);
  });

  it('food comes from the seed', () => {
    const foods = [1, 2, 3, 4].map((seed) => snake.init(seed).food.join());
    expect(new Set(foods).size).toBeGreaterThan(1);
  });
});

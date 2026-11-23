// STUB — replaced by the real port of the prototype's DEF.snake.
import type { BaseState, GameDef } from './types';

interface S extends BaseState { hits: number }

export const snake: GameDef<S> = {
  key: 'snake',
  version: 1,
  maxScorePerSecond: 10,
  scoreSlack: 0,
  init: (seed) => ({ score: 0, t: 0, seed, fx: [], hits: 0 }),
  update(s, input, dt) {
    s.t += dt;
    s.hits += input.presses.length;
    s.score = Math.floor(s.t * 10);
    return s.hits >= 5 || s.t > 20;
  },
};

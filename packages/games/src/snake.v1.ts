// ARCHIVED rules, version 1: a frozen copy of snake.ts as it was before version 2. Runs recorded on version 1
// replay with this file (apps/api/src/services/gameVersions.ts). Do not edit it.
// Snake on a 20 x 20 grid; left and right turn relative to the heading. Port of the prototype's DEF.snake.
import { rr } from './draw-util';
import { R } from './rng';
import { H, W, type BaseState, type GameDef } from './types';

type Cell = [number, number];

export interface SnakeState extends BaseState {
  /** Head first. */
  body: Cell[];
  dir: Cell;
  /** Time accumulated towards the next move. */
  acc: number;
  /** Queued turns, at most two. */
  turns: ('l' | 'r')[];
  food: Cell;
}

const CELLS = 20 * 20;

/** Picks a free cell for the food. */
function food(s: Pick<SnakeState, 'seed' | 'body'>): Cell {
  // The prototype would loop forever on a full board; there is no free cell, so park the food off the grid.
  if (s.body.length >= CELLS) return [-1, -1];
  let f: Cell;
  do {
    const fx = Math.floor(R(s, 0, 20));
    const fy = Math.floor(R(s, 0, 20));
    f = [fx, fy];
  } while (s.body.some((b) => b[0] === f[0] && b[1] === f[1]));
  return f;
}

export const snakeV1: GameDef<SnakeState> = {
  key: 'snake',
  version: 1,
  // One point per food and at most one cell per move; the move interval never drops below 0.07 s (1 / 0.07 = 14.3).
  maxScorePerSecond: 15,
  scoreSlack: 0,

  init(seed) {
    const s: SnakeState = { score: 0, t: 0, seed, fx: [], body: [[10, 10], [9, 10], [8, 10]], dir: [1, 0], acc: 0, turns: [], food: [0, 0] };
    s.food = food(s);
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    for (const q of input.presses) if ((q === 'l' || q === 'r') && s.turns.length < 2) s.turns.push(q);
    s.acc += dt;
    const step = Math.max(0.07, 0.15 - s.score * 0.0022);
    while (s.acc >= step) {
      s.acc -= step;
      const q = s.turns.shift();
      const [dx, dy] = s.dir;
      if (q === 'l') s.dir = [dy, -dx];
      if (q === 'r') s.dir = [-dy, dx];
      const head = s.body[0]!;
      const h: Cell = [head[0] + s.dir[0], head[1] + s.dir[1]];
      if (h[0] < 0 || h[1] < 0 || h[0] > 19 || h[1] > 19 || s.body.some((b) => b[0] === h[0] && b[1] === h[1])) return true;
      s.body.unshift(h);
      if (h[0] === s.food[0] && h[1] === s.food[1]) {
        s.score++;
        s.fx.push({ k: 'burst', x: h[0] * 24 + 12, y: 150 + h[1] * 24 + 12, c: '#ff4f6d', n: 14, sp: 190 });
        s.fx.push({ k: 'beep', f: 620, d: 0.06, w: 'triangle', v: 0.05 });
        s.food = food(s);
      } else {
        s.body.pop();
      }
    }
    return false;
  },

  draw(ctx, s) {
    ctx.fillStyle = '#0c2415';
    ctx.fillRect(0, 0, W, H);
    const oy = 150, c = 24;
    ctx.fillStyle = '#12331f';
    rr(ctx, 0, oy, 480, 480, 14);
    ctx.strokeStyle = '#1c4a2d';
    ctx.lineWidth = 1;
    for (let i = 1; i < 20; i++) {
      ctx.beginPath();
      ctx.moveTo(i * c, oy);
      ctx.lineTo(i * c, oy + 480);
      ctx.moveTo(0, oy + i * c);
      ctx.lineTo(480, oy + i * c);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff4f6d';
    ctx.beginPath();
    ctx.arc(s.food[0] * c + 12, oy + s.food[1] * c + 12, 9, 0, 7);
    ctx.fill();
    s.body.forEach((b, i) => {
      ctx.fillStyle = i ? (i % 2 ? '#4fd067' : '#7af08c') : '#b9ffc4';
      rr(ctx, b[0] * c + 1.5, oy + b[1] * c + 1.5, c - 3, c - 3, 7);
    });
  },
};

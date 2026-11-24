// Snake on a 20 x 20 grid; left and right turn relative to the heading. Port of the prototype's DEF.snake.
import { rr } from './draw-util';
import { beginFrame, drawBits, endFrame, glow, juice, kickFlash, pop, ring, sparks } from './juice';
import { ramp } from './pace';
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

/** Seconds per move. Version 2: follows a score that opens at 10 and rejoins the real score at 37 (the 0.07 s floor is reached at 36.4). */
export const snakeStep = (s: Pick<SnakeState, 'score'>): number => Math.max(0.07, 0.15 - ramp(s.score, 10, 37) * 0.0022);

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

export const snake: GameDef<SnakeState> = {
  key: 'snake',
  version: 2,
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
    const step = snakeStep(s);
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

  view(s) {
    const [hx, hy] = s.body[0]!;
    const nx = hx + s.dir[0], ny = hy + s.dir[1];
    const blocked = nx < 0 || ny < 0 || nx > 19 || ny > 19 || s.body.some((b, i) => i < s.body.length - 1 && b[0] === nx && b[1] === ny);
    const step = snakeStep(s);
    return { danger: blocked && !s.turns.length ? 0.4 + 0.6 * Math.min(1, s.acc / step) : 0, stats: [{ k: 'length', v: s.body.length }] };
  },

  draw(ctx, s) {
    const j = juice(s, () => ({ score: 0, eat: 9 }));
    const m = j.m;
    const oy = 150, c = 24;
    if (s.score > m.score) {
      const [hx, hy] = s.body[0]!;
      m.eat = 0;
      ring(j, hx * c + 12, oy + hy * c + 12, '#ff8fa3', 50, 0.35, 4);
      sparks(j, hx * c + 12, oy + hy * c + 12, '#ffd1da', 8, 220);
      if (s.score % 10 === 0) {
        pop(j, 240, 120, s.score + '!', '#7af08c', 34, 1);
        kickFlash(j, 0.15, '#7af08c');
      }
    }
    m.score = s.score;
    m.eat += j.dt;

    beginFrame(ctx, j);
    ctx.fillStyle = '#0c2415';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#12331f';
    rr(ctx, 0, oy, 480, 480, 14);
    // Grid lines shimmer outwards from the head after a meal.
    const [hx0, hy0] = s.body[0]!;
    ctx.lineWidth = 1;
    for (let i = 1; i < 20; i++) {
      const dv = Math.abs(i - hx0 - 0.5), dh = Math.abs(i - hy0 - 0.5);
      const wv = Math.max(0, 1 - Math.abs(dv - m.eat * 30) / 3), wh = Math.max(0, 1 - Math.abs(dh - m.eat * 30) / 3);
      ctx.strokeStyle = wv > 0 ? `rgba(122,240,140,${0.12 + wv * 0.35})` : '#1c4a2d';
      ctx.beginPath();
      ctx.moveTo(i * c, oy);
      ctx.lineTo(i * c, oy + 480);
      ctx.stroke();
      ctx.strokeStyle = wh > 0 ? `rgba(122,240,140,${0.12 + wh * 0.35})` : '#1c4a2d';
      ctx.beginPath();
      ctx.moveTo(0, oy + i * c);
      ctx.lineTo(480, oy + i * c);
      ctx.stroke();
    }
    // Food: bobbing, glowing.
    const fx = s.food[0] * c + 12, fy = oy + s.food[1] * c + 12;
    glow(ctx, fx, fy, 30, '#ff4f6d', 0.45 + 0.2 * Math.sin(s.t * 6));
    ctx.fillStyle = '#ff4f6d';
    ctx.beginPath();
    ctx.arc(fx, fy, 9 + Math.sin(s.t * 6) * 1.2, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff70';
    ctx.beginPath();
    ctx.arc(fx - 3, fy - 3, 3, 0, 7);
    ctx.fill();
    // Body: a bright pulse runs down the body after eating.
    const n = s.body.length;
    for (let i = n - 1; i >= 0; i--) {
      const b = s.body[i]!;
      const wave = Math.max(0, 1 - Math.abs(i - m.eat * 40) / 3);
      ctx.fillStyle = i ? (i % 2 ? '#4fd067' : '#7af08c') : '#b9ffc4';
      const g = i ? 1.5 - wave * 1.5 : 0;
      rr(ctx, b[0] * c + 1.5 + g, oy + b[1] * c + 1.5 + g, c - 3 - g * 2, c - 3 - g * 2, 7);
      if (wave > 0) {
        ctx.fillStyle = `rgba(255,255,255,${wave * 0.5})`;
        rr(ctx, b[0] * c + 1.5, oy + b[1] * c + 1.5, c - 3, c - 3, 7);
      }
    }
    // Eyes look the way the snake is heading.
    const [dx, dy] = s.dir;
    const ex = hx0 * c + 12 + dx * 4, ey = oy + hy0 * c + 12 + dy * 4;
    ctx.fillStyle = '#0c2415';
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ex + dy * 5 * k, ey - dx * 5 * k, 2.6, 0, 7);
      ctx.fill();
    }
    drawBits(ctx, j);
    endFrame(ctx, j);
  },
};

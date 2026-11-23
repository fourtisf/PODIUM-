// Stack: drop the sliding block on the tower; the overhang is cut off. Port of the prototype's DEF.stack.
import { rr, sky } from './draw-util';
import { H, W, type BaseState, type GameDef } from './types';

interface Block { x: number; w: number }

export interface StackState extends BaseState {
  blocks: Block[];
  cur: { x: number; w: number; dir: number };
  /** Seconds left of the PERFECT flash. */
  flash: number;
}

export const stack: GameDef<StackState> = {
  key: 'stack',
  version: 1,
  // One floor per drop and at most one drop per step (60 Hz). The slide speed is 230 + 9 per floor with no cap,
  // so there is no tighter constant bound.
  maxScorePerSecond: 60,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], blocks: [{ x: 140, w: 200 }], cur: { x: 0, w: 200, dir: 1 }, flash: 0 }),

  update(s, input, dt) {
    s.t += dt;
    s.flash = Math.max(0, s.flash - dt);
    const c = s.cur;
    const sp = 230 + s.score * 9;
    c.x += c.dir * sp * dt;
    if (c.x < 0) {
      c.x = 0;
      c.dir = 1;
    }
    if (c.x + c.w > W) {
      c.x = W - c.w;
      c.dir = -1;
    }

    if (input.presses.length > 0) {
      const p = s.blocks[s.blocks.length - 1]!;
      let x = Math.max(c.x, p.x);
      let w = Math.min(c.x + c.w, p.x + p.w) - x;
      if (w <= 0) return true;
      if (Math.abs(c.x - p.x) < 7) {
        x = p.x;
        w = p.w;
        s.flash = 0.25;
        s.fx.push({ k: 'burst', x: x + w / 2, y: 280, c: '#fff', n: 20, sp: 230 });
        s.fx.push({ k: 'beep', f: 880, d: 0.1, w: 'sine', v: 0.05 });
      }
      s.blocks.push({ x, w });
      s.score++;
      s.cur = { x: s.score % 2 ? W - w : 0, w, dir: s.score % 2 ? -1 : 1 };
    }
    return false;
  },

  draw(ctx, s) {
    sky(ctx, '#ffd3b8', '#ff8fb0');
    const n = s.blocks.length, off = Math.max(0, n - 9) * 36, y0 = 600;
    s.blocks.forEach((b, i) => {
      const y = y0 - (i + 1) * 36 + off;
      if (y > H) return;
      ctx.fillStyle = `hsl(${252 + i * 7},72%,${52 + Math.min(26, i)}%)`;
      rr(ctx, b.x, y, b.w, 34, 6);
    });
    const cy = y0 - (n + 1) * 36 + off;
    ctx.fillStyle = s.flash > 0 ? '#fff' : '#ffffffd9';
    rr(ctx, s.cur.x, cy, s.cur.w, 34, 6);
    if (s.flash > 0) {
      ctx.fillStyle = '#3b2a86';
      ctx.font = '700 16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('PERFECT', 240, cy + 70);
    }
  },
};

// Stack: drop the sliding block on the tower; the overhang is cut off. Port of the prototype's DEF.stack.
import { rr, sky } from './draw-util';
import { beginFrame, callout, drawBits, endFrame, juice, kickFlash, kickShake, ring, shard } from './juice';
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

  view(s) {
    return { danger: s.cur.w < 60 ? (60 - s.cur.w) / 60 : 0, stats: [{ k: 'floors', v: s.score }] };
  },

  draw(ctx, s) {
    const j = juice(s, () => ({ n: s.blocks.length, cur: { ...s.cur }, off: 0, perfect: 0, pAge: 9, drop: 9 }));
    const m = j.m;
    const n = s.blocks.length, y0 = 600;
    const want = Math.max(0, n - 9) * 36;
    if (n > m.n) {
      // A drop: the overhang of the block that was sliding falls away.
      const b = s.blocks[n - 1]!, c = m.cur;
      const y = y0 - n * 36 + m.off;
      const L = b.x - c.x, R = c.x + c.w - (b.x + b.w);
      if (L > 0.5) shard(j, c.x + L / 2, y + 17, L, 34, '#ffffffd9', -60, -40, -2.5, 1.2, 1300);
      if (R > 0.5) shard(j, b.x + b.w + R / 2, y + 17, R, 34, '#ffffffd9', 60, -40, 2.5, 1.2, 1300);
      m.drop = 0;
      if (s.flash > 0) {
        m.perfect++;
        m.pAge = 0;
        ring(j, b.x + b.w / 2, y + 17, '#ffffff', b.w * 0.8, 0.45, 6);
        if (m.perfect >= 3) kickFlash(j, 0.2, '#fff');
      } else {
        m.perfect = 0;
        kickShake(j, Math.min(0.3, (L + R) / 160));
      }
    }
    m.n = n;
    m.cur = { ...s.cur };
    m.off += (want - m.off) * Math.min(1, j.dt * 10);
    m.pAge += j.dt;
    m.drop += j.dt;
    const off = m.off;

    beginFrame(ctx, j);
    // The sky darkens towards dusk as the tower rises; stars come out.
    const h = Math.min(1, n / 120);
    sky(ctx, mix('#ffd3b8', '#2a1a5e', h), mix('#ff8fb0', '#7a4bd0', h));
    if (h > 0.2) {
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = (h - 0.2) * (0.4 + 0.4 * Math.sin(s.t * 2 + i));
        ctx.fillStyle = '#fff';
        ctx.fillRect((i * 97) % W, ((i * 53 + off * 0.2) % 400), 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // Clouds drift down past the tower (parallax).
    ctx.fillStyle = '#ffffff40';
    for (let i = 0; i < 4; i++) {
      const y = ((i * 190 + off * 0.5) % 820) - 120;
      ctx.beginPath();
      ctx.ellipse(((i * 151) % 420) + 30 + Math.sin(s.t * 0.3 + i) * 20, y, 80, 18, 0, 0, 7);
      ctx.fill();
    }
    s.blocks.forEach((b, i) => {
      const y = y0 - (i + 1) * 36 + off;
      if (y > H) return;
      const land = i === n - 1 && m.drop < 0.15 ? Math.sin((m.drop / 0.15) * Math.PI) * 4 : 0;
      ctx.fillStyle = `hsl(${252 + i * 7},72%,${52 + Math.min(26, i)}%)`;
      rr(ctx, b.x, y + land, b.w, 34, 6);
      ctx.fillStyle = '#ffffff30';
      rr(ctx, b.x + 4, y + 3 + land, b.w - 8, 6, 3);
    });
    const cy = y0 - (n + 1) * 36 + off;
    // Sliding block with a short motion trail.
    ctx.fillStyle = '#ffffff22';
    rr(ctx, s.cur.x - s.cur.dir * 14, cy, s.cur.w, 34, 6);
    ctx.fillStyle = s.flash > 0 ? '#fff' : '#ffffffd9';
    rr(ctx, s.cur.x, cy, s.cur.w, 34, 6);
    // Guide: where the block below sits.
    const p = s.blocks[n - 1]!;
    ctx.strokeStyle = '#ffffff55';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, cy + 34);
    ctx.lineTo(p.x, cy - 8);
    ctx.moveTo(p.x + p.w, cy + 34);
    ctx.lineTo(p.x + p.w, cy - 8);
    ctx.stroke();
    ctx.setLineDash([]);
    drawBits(ctx, j);
    endFrame(ctx, j);
    if (m.pAge < 1.1) callout(ctx, m.perfect > 1 ? 'PERFECT x' + m.perfect : 'PERFECT', 240, cy + 80, m.pAge, '#fff', 26);
  },
};

function mix(a: string, b: string, k: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) out += Math.round(p(a, i) + (p(b, i) - p(a, i)) * k).toString(16).padStart(2, '0');
  return out;
}

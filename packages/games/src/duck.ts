// Duck: steer the duck between drifting logs and collect coins. Port of the prototype's DEF.duck.
import { rr, sky } from './draw-util';
import { beginFrame, drawBits, endFrame, glow, juice, kickShake, pop, ring, speedLines, sparks } from './juice';
import { ramp } from './pace';
import { R, clamp } from './rng';
import { H, W, type BaseState, type Fx, type GameDef } from './types';

interface Log { x: number; y: number; w: number; h: number }
interface Coin { x: number; y: number }

export interface DuckState extends BaseState {
  x: number;
  obs: Log[];
  /** Seconds until the next log. */
  sp: number;
  coins: Coin[];
  /** Seconds until the next coin. */
  cs: number;
  bonus: number;
}

/** River speed in px/s (version 2 pacing). */
const flow = (t: number): number => 170 + ramp(t, 10, 40) * 9;

export const duck: GameDef<DuckState> = {
  key: 'duck',
  version: 2,
  // 10/s from time, plus coins worth 15 at most one per 1.1 s (15 / 1.1 = 13.7/s; the first appears at 1.5 s).
  // Version 2 changes only log speed and spacing, so the bound is unchanged.
  maxScorePerSecond: 24,
  scoreSlack: 0,

  init(seed) {
    const s: DuckState = { score: 0, t: 0, seed, fx: [], x: 240, obs: [], sp: 0.2, coins: [], cs: 1.5, bonus: 0 };
    // Version 2: two logs are already on the river when the run starts.
    for (const y of [220, -20]) {
      const w = R(s, 60, 130);
      s.obs.push({ x: R(s, 10, W - w - 10), y, w, h: 26 });
    }
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    const v = 300;
    if (input.l) s.x -= v * dt;
    if (input.r) s.x += v * dt;
    if (input.ptr) s.x += clamp(input.px - s.x, -v * dt, v * dt);
    s.x = clamp(s.x, 26, W - 26);

    // Version 2: the difficulty clock opens at 10 s and rejoins real time at 40 s.
    const e = ramp(s.t, 10, 40);
    const spd = 170 + e * 9; // = flow(s.t)
    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = Math.max(0.3, 0.8 - e * 0.012);
      const w = R(s, 60, 130);
      s.obs.push({ x: R(s, 10, W - w - 10), y: -40, w, h: 26 });
    }
    for (const o of s.obs) o.y += spd * dt;
    s.obs = s.obs.filter((o) => o.y < H + 40);
    for (const o of s.obs) {
      const nx = clamp(s.x, o.x, o.x + o.w);
      const ny = clamp(540, o.y, o.y + o.h);
      if ((nx - s.x) ** 2 + (ny - 540) ** 2 < 15 * 15) return true;
    }

    s.cs -= dt;
    if (s.cs <= 0) {
      s.cs = R(s, 1.1, 2.2);
      s.coins.push({ x: R(s, 30, W - 30), y: -20 });
    }
    for (let i = s.coins.length - 1; i >= 0; i--) {
      const c = s.coins[i]!;
      c.y += spd * dt;
      if (c.y > H + 20) s.coins.splice(i, 1);
      else if ((c.x - s.x) ** 2 + (c.y - 540) ** 2 < 900) {
        s.coins.splice(i, 1);
        s.bonus += 15;
        s.fx.push({ k: 'burst', x: c.x, y: c.y, c: '#ffd84a', n: 12 });
        s.fx.push({ k: 'beep', f: 880, d: 0.07, w: 'sine', v: 0.05 });
      }
    }
    s.score = Math.floor(s.t * 10) + s.bonus;
    return false;
  },

  view(s) {
    let danger = 0;
    for (const o of s.obs) {
      if (s.x < o.x - 24 || s.x > o.x + o.w + 24) continue;
      const gap = 540 - 15 - (o.y + o.h);
      if (gap > -o.h - 30 && gap < 150) danger = Math.max(danger, 1 - Math.max(0, gap) / 150);
    }
    return { danger };
  },

  impact: (f: Fx) => (f.k === 'burst' && f.c === '#ffd84a' ? 0.08 : 0),

  draw(ctx, s) {
    const j = juice(s, () => ({ dist: 0, px: s.x, lean: 0, trail: [] as { x: number; y: number }[], seen: new Set<Log>(), coins: new Set<Coin>() }));
    const m = j.m;
    const spd = flow(s.t);
    m.dist += spd * j.dt;
    if (j.dt > 0) m.lean += ((s.x - m.px) / j.dt / 300 - m.lean) * Math.min(1, j.dt * 12);
    m.px = s.x;
    // Wake: points left behind the duck drift down with the river.
    for (const p of m.trail) p.y += spd * j.dt;
    if (j.dt > 0) m.trail.push({ x: s.x, y: 560 });
    while (m.trail.length && m.trail[0]!.y > H + 20) m.trail.shift();
    if (m.trail.length > 40) m.trail.shift();
    // Near misses: a log slides past the duck's row within a whisker.
    for (const o of s.obs) {
      if (m.seen.has(o) || o.y < 540) continue;
      m.seen.add(o);
      const gap = s.x < o.x ? o.x - s.x - 15 : s.x - (o.x + o.w) - 15;
      if (gap >= 0 && gap < 18) {
        pop(j, s.x, 500, 'CLOSE!', '#7dd3fc', 20);
        sparks(j, s.x + (s.x < o.x ? 12 : -12), 540, '#bfe9ff', 6, 200);
        kickShake(j, 0.15);
      }
    }
    if (m.seen.size > 60) for (const o of m.seen) if (!s.obs.includes(o)) m.seen.delete(o);
    for (const c of m.coins) if (!s.coins.includes(c) && c.y > 470) ring(j, c.x, c.y, '#ffd84a', 40, 0.35, 4);
    m.coins = new Set(s.coins);

    beginFrame(ctx, j);
    sky(ctx, '#1f9aa0', '#0b4a70');
    // Deep current stripes (slow layer), then ripples (river speed).
    ctx.fillStyle = '#ffffff08';
    for (let i = 0; i < 7; i++) {
      const y = ((i * 110 + m.dist * 0.45) % (H + 120)) - 60;
      ctx.fillRect(60 + ((i * 61) % 300), y, 40 + (i % 3) * 30, 70);
    }
    ctx.strokeStyle = '#ffffff26';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const y = ((i * 47 + m.dist) % (H + 40)) - 20;
      const x = (i * 97) % W;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 22, y - 7, x + 44, y);
      ctx.stroke();
    }
    speedLines(ctx, s.t, Math.max(0, (spd - 230) / 300), 'down', '#e6fbff');
    // Banks: lily pads drift at river speed.
    for (let i = 0; i < 6; i++) {
      const y = ((i * 130 + m.dist) % (H + 90)) - 45;
      const x = i % 2 ? W - 20 : 20;
      ctx.fillStyle = '#2fae6a';
      ctx.beginPath();
      ctx.ellipse(x, y, 32, 14, 0, 0.5, 6);
      ctx.lineTo(x, y);
      ctx.fill();
      ctx.fillStyle = '#55d48a';
      ctx.beginPath();
      ctx.ellipse(x, y - 2, 22, 8, 0, 0.6, 5.9);
      ctx.lineTo(x, y);
      ctx.fill();
      if (i % 3 === 0) {
        ctx.fillStyle = '#ff8fb8';
        ctx.beginPath();
        ctx.arc(x, y - 6, 6, 0, 7);
        ctx.fill();
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        ctx.arc(x, y - 6, 2.5, 0, 7);
        ctx.fill();
      }
    }
    // Wake trail.
    ctx.strokeStyle = '#ffffff55';
    ctx.lineCap = 'round';
    for (let k = 0; k < m.trail.length; k++) {
      const p = m.trail[k]!, age = (p.y - 560) / 200;
      if (age < 0.05 || k % 2) continue;
      ctx.globalAlpha = Math.max(0, 0.5 - age * 0.5);
      ctx.lineWidth = 2 + age * 3;
      ctx.beginPath();
      ctx.moveTo(p.x - 14 - age * 34, p.y + 6);
      ctx.lineTo(p.x - 8 - age * 22, p.y - 2);
      ctx.moveTo(p.x + 14 + age * 34, p.y + 6);
      ctx.lineTo(p.x + 8 + age * 22, p.y - 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Logs, with foam where the current hits them.
    for (const o of s.obs) {
      ctx.fillStyle = '#06303f66';
      rr(ctx, o.x + 4, o.y + 7, o.w, o.h, 13);
      ctx.fillStyle = '#ffffff40';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h + 3, o.w / 2 + 4, 6, 0, 0, Math.PI);
      ctx.fill();
      const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
      g.addColorStop(0, '#b9773a');
      g.addColorStop(1, '#5a3210');
      ctx.fillStyle = g;
      rr(ctx, o.x, o.y, o.w, o.h, 13);
      ctx.strokeStyle = '#5a321099';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x + 14, o.y + 9);
      ctx.lineTo(o.x + o.w - 26, o.y + 9);
      ctx.moveTo(o.x + 24, o.y + 17);
      ctx.lineTo(o.x + o.w - 34, o.y + 17);
      ctx.stroke();
      ctx.fillStyle = '#e0a868';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w - 9, o.y + o.h / 2, 6, o.h / 2 - 3, 0, 0, 7);
      ctx.fill();
    }
    // Coins: glow and spin.
    for (const c of s.coins) {
      glow(ctx, c.x, c.y, 30, '#ffd84a', 0.35 + 0.15 * Math.sin(s.t * 8));
      const sx = Math.abs(Math.cos(s.t * 5 + c.x));
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 11 * Math.max(0.25, sx), 11, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#fff6c4';
      ctx.beginPath();
      ctx.ellipse(c.x - 3 * sx, c.y - 3, 4 * Math.max(0.25, sx), 4, 0, 0, 7);
      ctx.fill();
    }
    // Duck: leans into the turn.
    ctx.save();
    ctx.translate(s.x, 540);
    ctx.rotate(Math.max(-0.35, Math.min(0.35, m.lean * 0.3)));
    ctx.translate(-s.x, -540);
    duckBody(ctx, s.x, 540 + Math.sin(s.t * 9) * 1.5);
    ctx.restore();
    drawBits(ctx, j);
    endFrame(ctx, j);
  },
};

function duckBody(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#f0a400';
  ctx.beginPath();
  ctx.moveTo(x - 9, y + 18);
  ctx.lineTo(x, y + 32);
  ctx.lineTo(x + 9, y + 18);
  ctx.fill();
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 17, 22, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#f4a900';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 10, 13, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.arc(x, y - 17, 12.5, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#ff8a1f';
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 27);
  ctx.lineTo(x, y - 39);
  ctx.lineTo(x + 5, y - 27);
  ctx.fill();
  ctx.fillStyle = '#1a1030';
  ctx.beginPath();
  ctx.arc(x - 5, y - 19, 2, 0, 7);
  ctx.arc(x + 5, y - 19, 2, 0, 7);
  ctx.fill();
}

// ARCHIVED rules, version 1: a frozen copy of duck.ts as it was before version 2. Runs recorded on version 1
// replay with this file (apps/api/src/services/gameVersions.ts). Do not edit it.
// Duck: steer the duck between drifting logs and collect coins. Port of the prototype's DEF.duck.
import { rr, sky } from './draw-util';
import { R, clamp } from './rng';
import { H, W, type BaseState, type GameDef } from './types';

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

export const duckV1: GameDef<DuckState> = {
  key: 'duck',
  version: 1,
  // 10/s from time, plus coins worth 15 at most one per 1.1 s (15 / 1.1 = 13.7/s; the first appears at 1.5 s).
  maxScorePerSecond: 24,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], x: 240, obs: [], sp: 0.4, coins: [], cs: 1.5, bonus: 0 }),

  update(s, input, dt) {
    s.t += dt;
    const v = 300;
    if (input.l) s.x -= v * dt;
    if (input.r) s.x += v * dt;
    if (input.ptr) s.x += clamp(input.px - s.x, -v * dt, v * dt);
    s.x = clamp(s.x, 26, W - 26);

    const spd = 170 + s.t * 9;
    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = Math.max(0.3, 0.8 - s.t * 0.012);
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

  draw(ctx, s) {
    sky(ctx, '#1f9aa0', '#0b4a70');
    // Ripples.
    ctx.strokeStyle = '#ffffff26';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const y = ((i * 47 + s.t * 170) % (H + 40)) - 20;
      const x = (i * 97) % W;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 22, y - 7, x + 44, y);
      ctx.stroke();
    }
    // Lily pads along the banks.
    for (let i = 0; i < 6; i++) {
      const y = ((i * 130 + s.t * 170) % (H + 90)) - 45;
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
    // Logs.
    for (const o of s.obs) {
      ctx.fillStyle = '#06303f66';
      rr(ctx, o.x + 4, o.y + 7, o.w, o.h, 13);
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
    // Coins.
    for (const c of s.coins) {
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 11, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#fff6c4';
      ctx.beginPath();
      ctx.arc(c.x - 3, c.y - 3, 4, 0, 7);
      ctx.fill();
    }
    // Duck: wake, tail, body, head, beak, eyes.
    const x = s.x, y = 540;
    ctx.strokeStyle = '#ffffff40';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 14, y + 16);
    ctx.lineTo(x - 26, y + 62);
    ctx.moveTo(x + 14, y + 16);
    ctx.lineTo(x + 26, y + 62);
    ctx.stroke();
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
  },
};

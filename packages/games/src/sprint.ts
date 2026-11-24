// Sprint: auto-runner with a double jump over spikes. Port of the prototype's DEF.sprint.
import { rr, sky } from './draw-util';
import { ramp } from './pace';
import { R, rnd } from './rng';
import { W, type BaseState, type GameDef } from './types';

interface Spike { x: number; w: number; h: number }
interface Coin { x: number; y: number }

export interface SprintState extends BaseState {
  /** Height above the ground, negative while in the air. */
  y: number;
  vy: number;
  /** Jumps used since the last landing (0..2). */
  j: number;
  obs: Spike[];
  co: Coin[];
  bonus: number;
  /** Seconds until the next spike. */
  sp: number;
  dist: number;
}

export const sprint: GameDef<SprintState> = {
  key: 'sprint',
  version: 2,
  // Distance: speed (270 + 8 t) / 20 points per second, which has no cap, so it is taken at the longest run the
  // platform allows (economy.maxRunSeconds = 3600 s): average (270 + 4 * 3600) / 20 = 733.5/s. Coins: 10 each, at
  // most one per spawn, spawns at least 0.75 * 0.55 = 0.4125 s apart = 24.3/s. Total 757.8/s.
  // Version 2 adds 8 * (10 - t / 5) to the speed for t < 50 s: at most 2000 px (100 points) in a whole run, and
  // the spawn floor is the same, so the bound stands (757.4/s simulated at 60 Hz over 3600 s).
  maxScorePerSecond: 760,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], y: 0, vy: 0, j: 0, obs: [], co: [], bonus: 0, sp: 0.6, dist: 0 }),

  update(s, input, dt) {
    s.t += dt;
    // Version 2: the difficulty clock opens at 10 s and rejoins real time at 50 s.
    const e = ramp(s.t, 10, 50);
    const v = 270 + e * 8;
    s.dist += v * dt;
    s.score = Math.floor(s.dist / 20) + s.bonus;
    for (let i = 0; i < input.presses.length; i++) {
      if (s.j < 2) {
        s.vy = -600;
        s.j++;
        s.fx.push({ k: 'burst', x: 110, y: 500 + s.y, c: '#b6ffe6', n: 6, sp: 90 });
      }
    }
    s.vy += 1750 * dt;
    s.y += s.vy * dt;
    if (s.y >= 0) {
      s.y = 0;
      s.vy = 0;
      s.j = 0;
    }

    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = R(s, 0.75, 1.5) * Math.max(0.55, 1 - e * 0.006);
      const dbl = rnd(s) < 0.3;
      s.obs.push({ x: W + 30, w: dbl ? 52 : 28, h: R(s, 38, 66) });
      if (rnd(s) < 0.6) s.co.push({ x: W + 30 + (dbl ? 26 : 14), y: 500 - R(s, 112, 168) });
    }
    for (const o of s.obs) {
      o.x -= v * dt;
      if (o.x < 110 + 13 && o.x + o.w > 110 - 13 && -s.y < o.h - 6) return true;
    }
    s.obs = s.obs.filter((o) => o.x > -80);
    for (let i = s.co.length - 1; i >= 0; i--) {
      const c = s.co[i]!;
      c.x -= v * dt;
      if (c.x < -20) s.co.splice(i, 1);
      else if (Math.abs(c.x - 110) < 28 && Math.abs(c.y - (478 + s.y)) < 32) {
        s.co.splice(i, 1);
        s.bonus += 10;
        s.fx.push({ k: 'burst', x: c.x, y: c.y, c: '#ffd84a', n: 12 });
        s.fx.push({ k: 'beep', f: 880, d: 0.07, w: 'sine', v: 0.05 });
      }
    }
    return false;
  },

  draw(ctx, s) {
    sky(ctx, '#070b33', '#3a2f9a');
    // Moon.
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(380, 150, 40, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#f0d68a99';
    ctx.beginPath();
    ctx.arc(366, 140, 7, 0, 7);
    ctx.arc(394, 164, 10, 0, 7);
    ctx.fill();
    // Two parallax layers of buildings with windows.
    for (let l = 0; l < 2; l++) {
      for (let i = 0; i < 9; i++) {
        const sp = l ? 0.45 : 0.2;
        const x = ((((i * 120 - s.dist * sp) % 1080) + 1080) % 1080) - 120;
        const h = (l ? 90 : 150) + ((i * 67 + l * 40) % 130);
        ctx.fillStyle = l ? '#141a5c' : '#232a86';
        ctx.fillRect(x, 500 - h, l ? 96 : 84, h);
        ctx.fillStyle = l ? '#ffd98a70' : '#7dd3fc55';
        for (let w = 0; w < 5; w++) {
          const wx = x + 10 + ((i * 31 + w * 19) % (l ? 76 : 64));
          const wy = 500 - h + 12 + ((i * 17 + w * 43) % Math.max(20, h - 34));
          ctx.fillRect(wx, wy, 5, 7);
        }
      }
    }
    // Ground.
    ctx.fillStyle = '#060a27';
    ctx.fillRect(0, 500, W, 140);
    ctx.fillStyle = '#7af0c540';
    ctx.fillRect(0, 496, W, 12);
    ctx.fillStyle = '#b6ffe6';
    ctx.fillRect(0, 500, W, 4);
    // Spikes.
    for (const o of s.obs) {
      const n = o.w > 40 ? 2 : 1, w = o.w / n;
      for (let k = 0; k < n; k++) {
        const x0 = o.x + k * w;
        ctx.fillStyle = '#ff4f81';
        ctx.beginPath();
        ctx.moveTo(x0, 500);
        ctx.lineTo(x0 + w / 2, 500 - o.h);
        ctx.lineTo(x0 + w, 500);
        ctx.fill();
        ctx.fillStyle = '#ff9ab8';
        ctx.beginPath();
        ctx.moveTo(x0 + w / 2, 500 - o.h);
        ctx.lineTo(x0 + w * 0.62, 500 - o.h * 0.55);
        ctx.lineTo(x0 + w * 0.3, 500);
        ctx.lineTo(x0, 500);
        ctx.fill();
      }
    }
    // Coins.
    for (const c of s.co) {
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#fff6c4';
      ctx.beginPath();
      ctx.arc(c.x - 3, c.y - 3, 4, 0, 7);
      ctx.fill();
    }
    // Runner: scarf, speed lines, body, visor, legs.
    const y = 500 + s.y, wv = Math.sin(s.t * 14) * 5;
    ctx.fillStyle = '#ff4f81';
    ctx.beginPath();
    ctx.moveTo(104, y - 34);
    ctx.quadraticCurveTo(80, y - 38 + wv, 56, y - 30 - wv);
    ctx.lineTo(58, y - 22 - wv);
    ctx.quadraticCurveTo(82, y - 28 + wv, 104, y - 26);
    ctx.fill();
    ctx.fillStyle = '#ffffff40';
    ctx.fillRect(52, y - 12, 30, 3);
    ctx.fillRect(40, y - 4, 36, 3);
    const gr = ctx.createLinearGradient(0, y - 46, 0, y);
    gr.addColorStop(0, '#b6ffe6');
    gr.addColorStop(1, '#22b890');
    ctx.fillStyle = gr;
    rr(ctx, 96, y - 46, 28, 44, 11);
    ctx.fillStyle = '#0a1238';
    rr(ctx, 109, y - 38, 13, 9, 4);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(117, y - 33.5, 2.2, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#0a1238';
    const lg = s.y < 0 ? 0 : Math.sin(s.t * 22) * 6;
    rr(ctx, 100 + lg, y - 6, 8, 8, 3);
    rr(ctx, 112 - lg, y - 6, 8, 8, 3);
  },
};

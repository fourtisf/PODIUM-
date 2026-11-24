// ARCHIVED rules, version 1: a frozen copy of glide.ts as it was before version 2. Runs recorded on version 1
// replay with this file (apps/api/src/services/gameVersions.ts). Do not edit it.
// Glide: tap to flap a paper plane through ice gates and pick up stars. Port of the prototype's DEF.glide.
import { sky } from './draw-util';
import { R, clamp } from './rng';
import { H, W, type BaseState, type GameDef } from './types';

interface Gate {
  x: number;
  /** Centre of the gap. */
  gy: number;
  gap: number;
  /** Star offset from the gap centre. */
  so: number;
  /** 1 while the star is still there. */
  st: number;
  /** 1 once the plane has passed the gate. */
  p: number;
}

export interface GlideState extends BaseState {
  y: number;
  vy: number;
  gates: Gate[];
  /** Gates passed. */
  gp: number;
  /** False until the first tap. */
  go: boolean;
}

export const glideV1: GameDef<GlideState> = {
  key: 'glide',
  version: 1,
  // A gate is worth at most 3 (1 for passing, 2 for its star) and at most one gate is created per step: 3 * 60.
  // Scroll speed is 175 + 3 per gate passed with no cap, so there is no tighter constant bound.
  maxScorePerSecond: 180,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], y: 320, vy: 0, gates: [], gp: 0, go: false }),

  update(s, input, dt) {
    s.t += dt;
    for (let i = 0; i < input.presses.length; i++) {
      s.vy = -330;
      s.go = true;
    }
    if (!s.go) return false;

    s.vy += 900 * dt;
    s.y += s.vy * dt;
    const spd = 175 + s.gp * 3;
    const last = s.gates[s.gates.length - 1];
    if (!last || last.x < W - 235) {
      const gy = R(s, 170, 470);
      const gap = Math.max(118, 172 - s.gp * 2);
      const so = R(s, -28, 28);
      s.gates.push({ x: W + 40, gy, gap, so, st: 1, p: 0 });
    }
    for (const g of s.gates) {
      g.x -= spd * dt;
      if (!g.p && g.x < 140) {
        g.p = 1;
        s.score++;
        s.gp++;
      }
      if (g.st && Math.abs(g.x - 140) < 20 && Math.abs(s.y - (g.gy + g.so)) < 24) {
        g.st = 0;
        s.score += 2;
        s.fx.push({ k: 'burst', x: g.x, y: g.gy + g.so, c: '#ffd84a', n: 14 });
        s.fx.push({ k: 'beep', f: 990, d: 0.07, w: 'sine', v: 0.05 });
      }
      if (Math.abs(g.x - 140) < 40 && (s.y - 13 < g.gy - g.gap / 2 || s.y + 13 > g.gy + g.gap / 2)) return true;
    }
    s.gates = s.gates.filter((g) => g.x > -60);
    return s.y < 0 || s.y > H;
  },

  draw(ctx, s) {
    sky(ctx, '#06123a', '#3e7fc4');
    // Aurora.
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#7af0c5';
    ctx.lineWidth = 50;
    ctx.beginPath();
    ctx.moveTo(-30, 130 + 12 * Math.sin(s.t * 0.7));
    ctx.quadraticCurveTo(240, 30, 510, 120);
    ctx.stroke();
    ctx.strokeStyle = '#a79bff';
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(-30, 196);
    ctx.quadraticCurveTo(260, 110 + 10 * Math.cos(s.t * 0.5), 510, 176);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Gates: an icicle from the top and one from the bottom, then the star.
    for (const q of s.gates) {
      const t = q.gy - q.gap / 2, b = q.gy + q.gap / 2;
      const halves: [number, number, number][] = [[-10, t, -1], [H + 10, b, 1]];
      for (const [y0, y1, d] of halves) {
        ctx.fillStyle = '#8cc4ef';
        ctx.beginPath();
        ctx.moveTo(q.x - 30, y0);
        ctx.lineTo(q.x + 30, y0);
        ctx.lineTo(q.x + 30, y1 + d * 30);
        ctx.lineTo(q.x, y1);
        ctx.lineTo(q.x - 30, y1 + d * 30);
        ctx.fill();
        ctx.fillStyle = '#eaf8ff';
        ctx.beginPath();
        ctx.moveTo(q.x - 30, y0);
        ctx.lineTo(q.x - 6, y0);
        ctx.lineTo(q.x - 6, y1 + d * 6);
        ctx.lineTo(q.x - 30, y1 + d * 30);
        ctx.fill();
        ctx.fillStyle = '#ffffff90';
        ctx.fillRect(q.x - 24, Math.min(y0, y1 + d * 40), 5, Math.abs(y1 + d * 40 - y0));
      }
      if (q.st) {
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath();
        ctx.arc(q.x, q.gy + q.so, 10, 0, 7);
        ctx.fill();
        ctx.fillStyle = '#fff6c4';
        ctx.beginPath();
        ctx.arc(q.x - 3, q.gy + q.so - 3, 4, 0, 7);
        ctx.fill();
      }
    }

    // Snow.
    ctx.fillStyle = '#ffffffc0';
    for (let i = 0; i < 70; i++) {
      const x = (((i * 83 - s.t * (120 + (i % 5) * 30)) % W) + W) % W;
      const y = (i * 47 + s.t * (90 + (i % 4) * 25)) % H;
      ctx.fillRect(x, y, 1.5 + (i % 3), 1.5 + (i % 3));
    }

    // Plane.
    ctx.save();
    ctx.translate(140, s.y);
    ctx.rotate(clamp(s.vy / 600, -0.6, 0.9));
    ctx.fillStyle = '#ffffff50';
    ctx.beginPath();
    ctx.moveTo(-18, -2);
    ctx.lineTo(-70, -6);
    ctx.lineTo(-70, 6);
    ctx.lineTo(-18, 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(-20, -14);
    ctx.lineTo(-10, 0);
    ctx.fill();
    ctx.fillStyle = '#c9e2ff';
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(-10, 0);
    ctx.lineTo(-20, 14);
    ctx.fill();
    ctx.fillStyle = '#8fb6e6';
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-15, 8);
    ctx.lineTo(-2, 1);
    ctx.fill();
    ctx.restore();

    if (!s.go) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Tap or press space to start', 240, 300);
    }
  },
};

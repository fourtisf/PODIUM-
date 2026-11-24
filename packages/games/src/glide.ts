// Glide: tap to flap a paper plane through ice gates and pick up stars. Port of the prototype's DEF.glide.
import { sky, type Ctx } from './draw-util';
import { beginFrame, drawBits, endFrame, glow, juice, pop, ring, speedLines, sparks } from './juice';
import { ramp } from './pace';
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

function gate(s: GlideState, x: number): Gate {
  const gy = R(s, 170, 470);
  const gap = Math.max(118, 172 - ramp(s.gp, 6, 30) * 2);
  const so = R(s, -28, 28);
  return { x, gy, gap, so, st: 1, p: 0 };
}

export const glide: GameDef<GlideState> = {
  key: 'glide',
  version: 2,
  // A gate is worth at most 3 (1 for passing, 2 for its star) and at most one gate is created per step: 3 * 60.
  // Scroll speed is 175 + 3 per gate passed with no cap, so there is no tighter constant bound.
  maxScorePerSecond: 180,
  scoreSlack: 0,

  init(seed) {
    const s: GlideState = { score: 0, t: 0, seed, fx: [], y: 320, vy: 0, gates: [], gp: 0, go: false };
    // Version 2: the first gate is waiting at the right edge instead of 380 px away.
    s.gates.push(gate(s, W - 20));
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    for (let i = 0; i < input.presses.length; i++) {
      s.vy = -330;
      s.go = true;
    }
    if (!s.go) return false;

    s.vy += 900 * dt;
    s.y += s.vy * dt;
    // Version 2: speed and gap follow a gate count that opens at 6 and rejoins the real count at 30.
    const spd = 175 + ramp(s.gp, 6, 30) * 3;
    const last = s.gates[s.gates.length - 1];
    if (!last || last.x < W - 235) s.gates.push(gate(s, W + 40));
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

  view(s) {
    let danger = 0;
    if (s.go) {
      for (const g of s.gates) {
        if (g.x < 60 || g.x > 330) continue;
        const room = Math.min(s.y - 13 - (g.gy - g.gap / 2), g.gy + g.gap / 2 - (s.y + 13));
        danger = Math.max(danger, Math.max(0, 1 - room / 34) * Math.max(0, 1 - Math.abs(g.x - 140) / 190));
      }
      danger = Math.max(danger, s.y < 60 ? 1 - s.y / 60 : 0, s.y > 560 ? (s.y - 560) / 80 : 0);
    }
    return { danger: Math.min(1, danger), stats: [{ k: 'gates', v: s.gp }] };
  },

  draw(ctx, s) {
    const j = juice(s, () => ({ dist: 0, trail: [] as number[], gp: 0, vy: 0, stars: new Set<Gate>() }));
    const m = j.m;
    const spd = s.go ? 175 + ramp(s.gp, 6, 30) * 3 : 0;
    m.dist += spd * j.dt;
    if (j.dt > 0) {
      m.trail.unshift(s.y);
      if (m.trail.length > 18) m.trail.pop();
    }
    if (s.gp > m.gp) {
      pop(j, 140, s.y - 30, '+1', '#e6f6ff', 20, 0.6);
      ring(j, 140, s.y, '#bfe9ff', 46, 0.3, 3);
      if (s.gp % 10 === 0) pop(j, 240, 250, s.gp + ' GATES', '#ffd84a', 34, 1.1);
    }
    m.gp = s.gp;
    if (s.vy < m.vy - 200) ring(j, 118, s.y + 6, '#ffffff', 26, 0.25, 3);
    m.vy = s.vy;
    for (const g of s.gates) if (m.stars.has(g) && !g.st) sparks(j, g.x, g.gy + g.so, '#ffd84a', 10, 260);
    m.stars = new Set(s.gates.filter((g) => g.st));

    beginFrame(ctx, j);
    sky(ctx, '#06123a', '#3e7fc4');
    // Aurora.
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#7af0c5';
    ctx.lineWidth = 50;
    ctx.beginPath();
    ctx.moveTo(-30, 130 + 12 * Math.sin(s.t * 0.7));
    ctx.quadraticCurveTo(240, 30 + 20 * Math.sin(m.dist * 0.002), 510, 120);
    ctx.stroke();
    ctx.strokeStyle = '#a79bff';
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(-30, 196);
    ctx.quadraticCurveTo(260, 110 + 10 * Math.cos(s.t * 0.5), 510, 176);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Distant ice peaks and clouds scroll slower than the gates.
    peaks(ctx, m.dist * 0.12, 560, 90, '#1d3f7a');
    peaks(ctx, m.dist * 0.3, 600, 60, '#2a5b9a');
    ctx.fillStyle = '#ffffff12';
    for (let i = 0; i < 5; i++) {
      const x = ((((i * 150 - m.dist * 0.5) % 750) + 750) % 750) - 140;
      ctx.beginPath();
      ctx.ellipse(x, 260 + (i % 3) * 90, 110, 18, 0, 0, 7);
      ctx.fill();
    }
    speedLines(ctx, s.t, s.go ? Math.min(1, s.gp / 40) * 0.8 + 0.15 : 0, 'left', '#e6f6ff');

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
        const sy = q.gy + q.so;
        glow(ctx, q.x, sy, 34, '#ffd84a', 0.4 + 0.2 * Math.sin(s.t * 7));
        star(ctx, q.x, sy, 12, s.t * 2);
      }
    }

    // Snow.
    ctx.fillStyle = '#ffffffc0';
    for (let i = 0; i < 70; i++) {
      const x = (((i * 83 - s.t * (120 + (i % 5) * 30) - m.dist * 0.6) % W) + W) % W;
      const y = (i * 47 + s.t * (90 + (i % 4) * 25)) % H;
      ctx.fillRect(x, y, 1.5 + (i % 3), 1.5 + (i % 3));
    }

    // Contrail.
    if (s.go) {
      ctx.lineCap = 'round';
      for (let k = 1; k < m.trail.length; k++) {
        ctx.globalAlpha = 0.35 * (1 - k / m.trail.length);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6 * (1 - k / m.trail.length) + 1;
        ctx.beginPath();
        ctx.moveTo(122 - (k - 1) * spd / 60, m.trail[k - 1]!);
        ctx.lineTo(122 - k * spd / 60, m.trail[k]!);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
    drawBits(ctx, j);
    endFrame(ctx, j);

    if (!s.go) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Tap or press space to start', 240, 300);
    }
  },
};

function peaks(ctx: Ctx, off: number, base: number, amp: number, c: string): void {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) {
    const u = x + off;
    const k = ((u % 160) + 160) % 160;
    ctx.lineTo(x, base - amp * (1 - Math.abs(k - 80) / 80) * (0.6 + 0.4 * Math.abs(Math.sin(Math.floor(u / 160) * 1.7))));
  }
  ctx.lineTo(W, H);
  ctx.fill();
}

function star(ctx: Ctx, x: number, y: number, r: number, rot: number): void {
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5, rad = i % 2 ? r * 0.48 : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.fill();
  ctx.fillStyle = '#fff6c4';
  ctx.beginPath();
  ctx.arc(x - 2, y - 2, 3, 0, 7);
  ctx.fill();
}

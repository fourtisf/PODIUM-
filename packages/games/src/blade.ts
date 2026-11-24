// Blade: slash left or right as enemies close in from both sides. Port of the prototype's DEF.blade.
import { sky, type Ctx } from './draw-util';
import { beginFrame, drawBits, endFrame, glow, juice, kickFlash, kickPunch, kickShake, ring, sparks, type Juice } from './juice';
import { ramp } from './pace';
import { R, rnd } from './rng';
import { W, type BaseState, type Fx, type GameDef } from './types';

interface Enemy { side: number; d: number; v: number }
interface Slash { side: number; t: number; hit: number }

export interface BladeState extends BaseState {
  en: Enemy[];
  /** Seconds until the next enemy. */
  sp: number;
  /** Cooldown after a missed slash. */
  cd: number;
  sl: Slash | null;
  combo: number;
}

export const blade: GameDef<BladeState> = {
  key: 'blade',
  version: 2,
  // A kill is worth 1 + floor(combo / 6) and the combo has no cap, so score grows with the square of the kills.
  // Kills are limited by spawns (at least 0.7 * max(0.32, 1 - 0.013 t) s apart) and no run can pass t = 1822 s
  // (enemy speed 95 + 4 t then steps over the 24..125 px kill window in one frame). The worst case over that
  // whole span (every spawn killed at once, 60 Hz) is 2731 points per second; a constant bound cannot be tighter.
  // Version 2 (the clock opens at 12 s, first spawn at 0.3 s) adds a few early spawns: the same worst case,
  // simulated at 60 Hz, rises by 8 points per second (2719 -> 2727 in that simulation), still under 2750.
  maxScorePerSecond: 2750,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], en: [], sp: 0.3, cd: 0, sl: null, combo: 0 }),

  update(s, input, dt) {
    s.t += dt;
    s.cd = Math.max(0, s.cd - dt);
    if (s.sl) {
      s.sl.t -= dt;
      if (s.sl.t <= 0) s.sl = null;
    }

    // Version 2: the difficulty clock opens at 12 s and rejoins real time at 48 s (version 1 used s.t throughout).
    const e = ramp(s.t, 12, 48);
    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = Math.max(0.32, 1 - e * 0.013) * R(s, 0.7, 1.2);
      const side = rnd(s) < 0.5 ? -1 : 1;
      s.en.push({ side, d: 270, v: 95 + e * 4 + R(s, 0, 35) });
    }

    for (const q of input.presses) {
      if (q !== 'l' && q !== 'r') continue;
      if (s.cd > 0) continue;
      const side = q === 'l' ? -1 : 1;
      let best: Enemy | null = null;
      for (const e of s.en) if (e.side === side && e.d < 125 && (!best || e.d < best.d)) best = e;
      if (best) {
        s.en.splice(s.en.indexOf(best), 1);
        s.combo = s.combo + 1;
        s.score += 1 + Math.floor(s.combo / 6);
        const ex = 240 + best.side * best.d;
        s.fx.push({ k: 'burst', x: ex, y: 430, c: '#ff4f81', n: 14, sp: 220 });
        s.fx.push({ k: 'burst', x: ex, y: 430, c: '#fff', n: 6, sp: 130 });
        s.fx.push({ k: 'beep', f: 500 + Math.min(500, s.combo * 30), d: 0.06, w: 'triangle', v: 0.05 });
        s.sl = { side, t: 0.14, hit: 1 };
      } else {
        s.cd = 0.42;
        s.combo = 0;
        s.sl = { side, t: 0.14, hit: 0 };
      }
    }

    for (const e of s.en) {
      e.d -= e.v * dt;
      if (e.d < 24) return true;
    }
    return false;
  },

  view(s) {
    let near = 999;
    for (const e of s.en) near = Math.min(near, e.d);
    return {
      danger: Math.max(0, Math.min(1, (80 - near) / 56)),
      mult: 1 + Math.floor(s.combo / 6),
      stats: [{ k: 'streak', v: s.combo }, { k: 'combo', v: 1 + Math.floor(s.combo / 6) }],
    };
  },

  impact: (f: Fx) => (f.k === 'burst' && f.c === '#ff4f81' ? 0.22 : 0),

  draw(ctx, s) {
    const j = juice(s, mem);
    const m = j.m;
    // Kills and misses, found by comparing with the previous frame (display only).
    for (const [e, x] of m.prev) {
      if (!s.en.includes(e) && e.d < 140) {
        m.kills.push({ x, side: e.side, age: 0, spin: (Math.random() - 0.5) * 3 });
        sparks(j, x, 430, '#fff', 10, 420);
        ring(j, x, 430, '#ff9ab8', 70, 0.3, 5);
        kickPunch(j, x, 430);
        kickFlash(j, 0.18);
      }
    }
    m.prev.clear();
    for (const e of s.en) m.prev.set(e, 240 + e.side * e.d);
    if (s.sl && s.sl !== m.lastSl) {
      m.lastSl = s.sl;
      if (!s.sl.hit) {
        kickShake(j, 0.35);
        kickFlash(j, 0.25, '#ff2a50');
        m.missAge = 0;
      }
    }
    m.missAge += j.dt;
    if (s.combo > m.lastCombo) m.comboAge = 0;
    m.lastCombo = s.combo;
    m.comboAge += j.dt;

    beginFrame(ctx, j);
    background(ctx, s.t);

    // Strike range on the ground: the band where a slash connects (24..125 px from the player).
    ctx.fillStyle = '#ffffff10';
    ctx.fillRect(115, 468, 250, 4);
    for (const side of [-1, 1]) {
      const hot = s.en.some((e) => e.side === side && e.d < 125);
      ctx.fillStyle = hot ? '#ff4f81' : '#ffffff40';
      ctx.fillRect(240 + side * 125 - 1.5, 462, 3, 16);
      ctx.fillStyle = hot ? '#ff4f8155' : '#ffffff14';
      ctx.fillRect(side > 0 ? 264 : 115, 468, 101, 4);
    }

    // Enemies: ground marker (grey while out of range, red and pulsing inside it), streak, body.
    for (const e of s.en) {
      const x = 240 + e.side * e.d;
      const inR = e.d < 125;
      const pulse = 0.6 + 0.4 * Math.sin(s.t * 22);
      ctx.fillStyle = inR ? `rgba(255,79,129,${0.45 + 0.4 * pulse})` : '#ffffff22';
      ctx.beginPath();
      ctx.ellipse(x, 473, inR ? 30 : 24, inR ? 7 : 5, 0, 0, 7);
      ctx.fill();
      if (inR) glow(ctx, x, 440, 60, '#ff4f81', 0.25 * pulse);
      if (e.v > 150) {
        ctx.strokeStyle = '#ffffff22';
        ctx.lineWidth = 2;
        for (const yy of [430, 445, 455]) {
          ctx.beginPath();
          ctx.moveTo(x + e.side * 18, yy);
          ctx.lineTo(x + e.side * (18 + (e.v - 120) * 0.25), yy);
          ctx.stroke();
        }
      }
      fig(ctx, x, -Math.abs(Math.sin(e.d * 0.11)) * 5, 1, '#07031c', inR ? 2 : 1);
    }

    // Sliced enemies: the top half flies off and spins, the bottom half drops.
    for (let i = m.kills.length - 1; i >= 0; i--) {
      const k = m.kills[i]!;
      k.age += j.dt;
      if (k.age > 0.6) {
        m.kills.splice(i, 1);
        continue;
      }
      const a = k.age, out = k.side;
      ctx.globalAlpha = Math.max(0, 1 - a / 0.6);
      ctx.save();
      ctx.beginPath();
      ctx.rect(k.x - 60, 330, 120, 104);
      ctx.translate(out * a * 260, -a * 220 + a * a * 700);
      ctx.translate(k.x, 430);
      ctx.rotate(k.spin * a * 3);
      ctx.translate(-k.x, -430);
      ctx.clip();
      fig(ctx, k.x, 0, 1, '#2a0c3a', 0);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(k.x - 60, 434, 120, 50);
      ctx.translate(out * a * 90, a * a * 300);
      ctx.clip();
      fig(ctx, k.x, 0, 1, '#2a0c3a', 0);
      ctx.restore();
      // The cut line.
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * (1 - a / 0.6);
      ctx.beginPath();
      ctx.moveTo(k.x - 36, 438);
      ctx.lineTo(k.x + 36, 426);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Player; greyed out while locked after a miss.
    const locked = s.cd > 0;
    const bob = Math.sin(s.t * 3) * 1.5;
    fig(ctx, 240, bob, 1.3, locked ? '#4a4670' : '#05021a', 0);
    if (locked) {
      // Lock ring: drains over the 0.42 s cooldown.
      ctx.strokeStyle = '#ffffff22';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(240, 382, 26, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = '#fb7185';
      ctx.beginPath();
      ctx.arc(240, 382, 26, -Math.PI / 2, -Math.PI / 2 + (s.cd / 0.42) * Math.PI * 2);
      ctx.stroke();
    }

    // Sword (grey while locked) and the slash arc.
    const dir = s.sl ? s.sl.side : 1;
    const swing = s.sl ? 1 - s.sl.t / 0.14 : 0;
    ctx.save();
    ctx.translate(240 + dir * 14, 412 + bob);
    ctx.rotate(dir * (s.sl ? -0.6 + swing * 1.8 : 0));
    ctx.strokeStyle = locked ? '#6a6690' : '#bfe9ff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * 46, -56);
    ctx.stroke();
    if (!locked) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dir * 6, -8);
      ctx.lineTo(dir * 44, -54);
      ctx.stroke();
    }
    ctx.restore();
    if (s.sl) drawSlash(ctx, s.sl.side, swing, !!s.sl.hit);

    drawBits(ctx, j);
    endFrame(ctx, j);

    // Combo counter and the miss lock, above the fight.
    ctx.textAlign = 'center';
    if (locked) {
      const a = m.missAge;
      const sc = a < 0.1 ? 1.6 - a * 6 : 1;
      ctx.font = `900 ${Math.round(30 * sc)}px system-ui`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#0a0d24cc';
      ctx.strokeText('MISS', 240, 320);
      ctx.fillStyle = '#fb7185';
      ctx.fillText('MISS', 240, 320);
      ctx.font = '700 13px system-ui';
      ctx.fillStyle = '#ffffffaa';
      ctx.fillText('LOCKED', 240, 340);
    } else if (s.combo >= 2) {
      const a = m.comboAge;
      const sc = a < 0.12 ? 1.35 - a * 2.9 : 1;
      const mult = 1 + Math.floor(s.combo / 6);
      ctx.lineJoin = 'round';
      ctx.font = `900 ${Math.round(34 * sc)}px system-ui`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#0a0d24cc';
      ctx.strokeText(s.combo + ' HITS', 240, 318);
      ctx.fillStyle = mult > 1 ? '#ffd84a' : '#fff';
      ctx.fillText(s.combo + ' HITS', 240, 318);
      // Progress to the next multiplier.
      const into = s.combo % 6;
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i < into ? '#ffd84a' : '#ffffff30';
        ctx.fillRect(240 - 45 + i * 15, 328, 12, 4);
      }
      if (mult > 1) {
        ctx.font = '800 14px system-ui';
        ctx.fillStyle = '#ffd84a';
        ctx.fillText('x' + mult + ' POINTS', 240, 350);
      }
    }
  },
};

interface Mem {
  prev: Map<Enemy, number>;
  kills: { x: number; side: number; age: number; spin: number }[];
  lastSl: Slash | null;
  lastCombo: number;
  comboAge: number;
  missAge: number;
}
const mem = (): Mem => ({ prev: new Map(), kills: [], lastSl: null, lastCombo: 0, comboAge: 9, missAge: 9 });
export type BladeJuice = Juice<Mem>;

/** A hooded figure standing on the ground line (y 470). `glowEyes` 2 = in strike range. */
function fig(ctx: Ctx, x: number, dy: number, sc: number, col: string, glowEyes: number): void {
  ctx.save();
  ctx.translate(x, 470 + dy);
  ctx.scale(sc, sc);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-13, -52);
  ctx.quadraticCurveTo(-20, -24, -23, 0);
  ctx.lineTo(23, 0);
  ctx.quadraticCurveTo(20, -24, 13, -52);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -60, 10, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-24, -63);
  ctx.lineTo(0, -79);
  ctx.lineTo(24, -63);
  ctx.quadraticCurveTo(0, -57, -24, -63);
  ctx.fill();
  if (glowEyes) {
    ctx.fillStyle = glowEyes > 1 ? '#ff9ab8' : '#ff4f81';
    ctx.fillRect(-6, -62, 4, 3);
    ctx.fillRect(2, -62, 4, 3);
    if (glowEyes > 1) {
      ctx.fillStyle = '#ff4f8155';
      ctx.fillRect(-9, -64, 18, 7);
    }
  }
  ctx.restore();
}

/** The slash: a thick crescent that sweeps out over the swing, bright on a hit, faint on a miss. */
function drawSlash(ctx: Ctx, side: number, p: number, hit: boolean): void {
  const [a0, a1] = side > 0 ? [-1.25, 1.05] : [Math.PI - 1.05, Math.PI + 1.25];
  const sweep = Math.min(1, p * 2.2);
  const fade = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
  const from = side > 0 ? a0 : a1, span = (a1 - a0) * sweep * (side > 0 ? 1 : -1);
  ctx.lineCap = 'round';
  const layers: [number, string, number][] = hit
    ? [[30, '#7dd3fc', 0.18], [18, '#bfe9ff', 0.4], [8, '#ffffff', 1]]
    : [[14, '#ffffff', 0.12], [5, '#ffffff', 0.45]];
  for (const [w, c, a] of layers) {
    ctx.globalAlpha = a * fade;
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(240, 430, 104, Math.min(from, from + span), Math.max(from, from + span));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

let stars: [number, number, number][] | null = null;
/** Night sky with twinkling stars, a glowing moon, two drifting mountain ranges and mist. */
function background(ctx: Ctx, t: number): void {
  sky(ctx, '#150a3c', '#7a2a7a');
  if (!stars) {
    stars = [];
    for (let i = 0; i < 46; i++) stars.push([(i * 97.3) % W, (i * 53.7) % 300, (i * 0.37) % 6.28]);
  }
  for (const [x, y, ph] of stars) {
    ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + ph * 3));
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
  glow(ctx, 352, 236, 170, '#ffd6ec', 0.35);
  ctx.fillStyle = '#ffe6ef';
  ctx.beginPath();
  ctx.arc(352, 236, 78, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#eaa9c680';
  ctx.beginPath();
  ctx.arc(330, 214, 13, 0, 7);
  ctx.arc(380, 262, 18, 0, 7);
  ctx.fill();
  // Far range, drifting slowly.
  ridge(ctx, '#2a1460', 330, 34, t * 7, 0.021, 0.052);
  // Mist band.
  for (let i = 0; i < 4; i++) {
    const x = ((((i * 190 - t * 16) % 760) + 760) % 760) - 140;
    ctx.fillStyle = '#ffffff0c';
    ctx.beginPath();
    ctx.ellipse(x, 372 + (i % 2) * 14, 130, 12, 0, 0, 7);
    ctx.fill();
  }
  // Near hills, drifting a little faster.
  ridge(ctx, '#3a1869', 380, 24, t * 15, 0.017, 0.043);
  ctx.fillStyle = '#0d0526';
  ctx.fillRect(0, 470, W, 170);
  // Ground texture streaks.
  ctx.fillStyle = '#ffffff08';
  for (let i = 0; i < 6; i++) ctx.fillRect(((i * 131 + t * 30) % 560) - 40, 500 + i * 22, 60 + (i % 3) * 30, 2);
}

function ridge(ctx: Ctx, c: string, base: number, amp: number, off: number, f1: number, f2: number): void {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(0, 640);
  for (let x = 0; x <= W; x += 12) {
    const u = x + off;
    ctx.lineTo(x, base - amp * (0.6 * Math.abs(Math.sin(u * f1)) + 0.4 * Math.sin(u * f2)));
  }
  ctx.lineTo(W, 640);
  ctx.fill();
}

// Blade: slash left or right as enemies close in from both sides. Port of the prototype's DEF.blade.
import { sky } from './draw-util';
import { R, rnd } from './rng';
import { W, type BaseState, type GameDef } from './types';

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
  version: 1,
  // A kill is worth 1 + floor(combo / 6) and the combo has no cap, so score grows with the square of the kills.
  // Kills are limited by spawns (at least 0.7 * max(0.32, 1 - 0.013 t) s apart) and no run can pass t = 1822 s
  // (enemy speed 95 + 4 t then steps over the 24..125 px kill window in one frame). The worst case over that
  // whole span (every spawn killed at once, 60 Hz) is 2731 points per second; a constant bound cannot be tighter.
  maxScorePerSecond: 2750,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], en: [], sp: 0.7, cd: 0, sl: null, combo: 0 }),

  update(s, input, dt) {
    s.t += dt;
    s.cd = Math.max(0, s.cd - dt);
    if (s.sl) {
      s.sl.t -= dt;
      if (s.sl.t <= 0) s.sl = null;
    }

    s.sp -= dt;
    if (s.sp <= 0) {
      s.sp = Math.max(0.32, 1 - s.t * 0.013) * R(s, 0.7, 1.2);
      const side = rnd(s) < 0.5 ? -1 : 1;
      s.en.push({ side, d: 270, v: 95 + s.t * 4 + R(s, 0, 35) });
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

  draw(ctx, s) {
    sky(ctx, '#150a3c', '#7a2a7a');
    // Moon.
    ctx.fillStyle = '#ffe6ef';
    ctx.beginPath();
    ctx.arc(352, 236, 78, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#eaa9c680';
    ctx.beginPath();
    ctx.arc(330, 214, 13, 0, 7);
    ctx.arc(380, 262, 18, 0, 7);
    ctx.fill();
    // Hills and ground.
    ctx.fillStyle = '#3a1869';
    ctx.beginPath();
    ctx.moveTo(0, 410);
    const ridge: [number, number][] = [[60, 350], [120, 384], [200, 330], [270, 378], [340, 342], [420, 384], [480, 348]];
    for (const p of ridge) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(480, 640);
    ctx.lineTo(0, 640);
    ctx.fill();
    ctx.fillStyle = '#0d0526';
    ctx.fillRect(0, 470, W, 170);
    ctx.fillStyle = '#ffffff16';
    ctx.fillRect(115, 468, 250, 3);

    const fig = (x: number, sc: number, col: string, eyes: boolean): void => {
      ctx.save();
      ctx.translate(x, 470);
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
      if (eyes) {
        ctx.fillStyle = '#ff4f81';
        ctx.fillRect(-6, -62, 4, 3);
        ctx.fillRect(2, -62, 4, 3);
      }
      ctx.restore();
    };
    for (const e of s.en) fig(240 + e.side * e.d, 1, '#07031c', true);
    fig(240, 1.3, s.cd > 0 ? '#4a4670' : '#05021a', false);

    // Sword and slash arc.
    const dir = s.sl ? s.sl.side : 1;
    ctx.strokeStyle = '#bfe9ff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(240 + dir * 16, 410);
    ctx.lineTo(240 + dir * 60, 356);
    ctx.stroke();
    if (s.sl) {
      ctx.strokeStyle = s.sl.hit ? '#fff' : '#ffffff55';
      ctx.lineWidth = 7;
      ctx.beginPath();
      const a: [number, number] = s.sl.side > 0 ? [-1.1, 1] : [Math.PI - 1, Math.PI + 1.1];
      ctx.arc(240, 430, 104, a[0], a[1]);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    if (s.cd > 0) {
      ctx.fillStyle = '#fb7185';
      ctx.font = '700 15px system-ui';
      ctx.fillText('MISS', 240, 330);
    } else if (s.combo >= 6) {
      ctx.fillStyle = '#ffd84a';
      ctx.font = '800 20px system-ui';
      ctx.fillText('COMBO x' + (1 + Math.floor(s.combo / 6)), 240, 330);
    }
  },
};

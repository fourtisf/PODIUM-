// Hoop: shoot straight up at a hoop that slides side to side; three misses end the run. Port of the prototype's DEF.hoop.
import { rr } from './draw-util';
import { H, W, type BaseState, type GameDef } from './types';

export interface HoopState extends BaseState {
  /** Phase of the hoop's swing. */
  ph: number;
  ball: { y: number } | null;
  lives: number;
  msg: string;
  /** Seconds the message stays up. */
  mt: number;
}

/** Hoop centre x. */
const hx = (s: HoopState): number => 240 + 175 * Math.sin(s.ph);

export const hoop: GameDef<HoopState> = {
  key: 'hoop',
  version: 1,
  // One point per shot; the ball needs 21 steps to rise from 560 to 258 at 880 px/s, so at most 60 / 21 = 2.86 shots/s.
  maxScorePerSecond: 3,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], ph: 0, ball: null, lives: 3, msg: '', mt: 0 }),

  update(s, input, dt) {
    s.t += dt;
    s.mt = Math.max(0, s.mt - dt);
    s.ph += dt * (1.5 + s.score * 0.11);
    if (input.presses.length > 0 && !s.ball) s.ball = { y: 560 };
    if (s.ball) {
      s.ball.y -= 880 * dt;
      if (s.ball.y <= 258) {
        const r = Math.max(26, 46 - s.score * 0.5);
        if (Math.abs(hx(s) - 240) < r) {
          s.score++;
          s.msg = 'SWISH';
          s.fx.push({ k: 'burst', x: hx(s), y: 262, c: '#fff', n: 16, sp: 210 });
          s.fx.push({ k: 'burst', x: hx(s), y: 262, c: '#ffb347', n: 10, sp: 170 });
          s.fx.push({ k: 'beep', f: 700, d: 0.1, w: 'sine', v: 0.05 });
        } else {
          s.lives--;
          s.msg = 'MISS';
          if (s.lives <= 0) return true;
        }
        s.mt = 0.5;
        s.ball = null;
      }
    }
    return false;
  },

  draw(ctx, s) {
    // Court.
    ctx.fillStyle = '#f28a3a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#c9601c';
    ctx.fillRect(0, 470, W, 170);
    ctx.strokeStyle = '#ffffff80';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 470);
    ctx.lineTo(W, 470);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(240, 640, 150, Math.PI, 0);
    ctx.stroke();
    // Backboard, net, rim.
    const x = hx(s), r = Math.max(26, 46 - s.score * 0.5);
    ctx.fillStyle = '#fff';
    rr(ctx, x - 70, 150, 140, 96, 8);
    ctx.strokeStyle = '#ff3d3d';
    ctx.lineWidth = 5;
    ctx.strokeRect(x - 26, 192, 52, 40);
    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i * r) / 2.2, 260);
      ctx.lineTo(x + (i * r) / 3.4, 306);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ff3d3d';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(x, 258, r, 9, 0, 0, 7);
    ctx.stroke();
    // Ball.
    const by = s.ball ? s.ball.y : 560;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(240, by, 24, 0, 7);
    ctx.fill();
    ctx.strokeStyle = '#7a3b0c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(216, by);
    ctx.lineTo(264, by);
    ctx.moveTo(240, by - 24);
    ctx.lineTo(240, by + 24);
    ctx.stroke();
    // Lives and message.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < s.lives ? '#fff' : '#ffffff40';
      ctx.beginPath();
      ctx.arc(30 + i * 24, 610, 8, 0, 7);
      ctx.fill();
    }
    if (s.mt > 0) {
      ctx.fillStyle = s.msg === 'MISS' ? '#7a1f1f' : '#fff';
      ctx.font = '800 34px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(s.msg, 240, 400);
    }
  },
};

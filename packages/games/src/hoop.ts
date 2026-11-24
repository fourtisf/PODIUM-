// Hoop: shoot straight up at a hoop that slides side to side; three misses end the run. Port of the prototype's DEF.hoop.
import { rr } from './draw-util';
import { beginFrame, callout, drawBits, endFrame, glow, juice, kickFlash, kickShake, ring, sparks } from './juice';
import { ramp } from './pace';
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
/** Version 2: swing speed and rim size follow a score that opens at 8 and rejoins the real score at 40 (where the rim reaches 26). */
const lv = (s: HoopState): number => ramp(s.score, 8, 40);
/** Rim half-width. */
export const hoopRim = (s: HoopState): number => Math.max(26, 46 - lv(s) * 0.5);

export const hoop: GameDef<HoopState> = {
  key: 'hoop',
  version: 2,
  // One point per shot; the ball needs 21 steps to rise from 560 to 258 at 880 px/s, so at most 60 / 21 = 2.86 shots/s.
  maxScorePerSecond: 3,
  scoreSlack: 0,

  init: (seed) => ({ score: 0, t: 0, seed, fx: [], ph: 0, ball: null, lives: 3, msg: '', mt: 0 }),

  update(s, input, dt) {
    s.t += dt;
    s.mt = Math.max(0, s.mt - dt);
    s.ph += dt * (1.5 + lv(s) * 0.11);
    if (input.presses.length > 0 && !s.ball) s.ball = { y: 560 };
    if (s.ball) {
      s.ball.y -= 880 * dt;
      if (s.ball.y <= 258) {
        const r = hoopRim(s);
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

  view(s) {
    return { danger: s.lives === 1 ? 0.45 : 0, stats: [{ k: 'lives', v: s.lives }] };
  },

  draw(ctx, s) {
    const j = juice(s, () => ({ score: 0, lives: s.lives, streak: 0, streakAge: 9, net: 9, ballY: [] as number[], miss: null as null | { x: number; y: number; vx: number; vy: number; a: number } }));
    const m = j.m;
    const x = hx(s), r = hoopRim(s);
    if (s.score > m.score) {
      m.streak++;
      m.streakAge = 0;
      m.net = 0;
      ring(j, x, 258, '#ffffff', 70, 0.35, 5);
      sparks(j, x, 258, '#ffe1b0', 12, 300);
      if (m.streak >= 3) kickFlash(j, 0.15, '#ffd84a');
    }
    if (s.lives < m.lives) {
      m.streak = 0;
      kickShake(j, 0.3);
      kickFlash(j, 0.2, '#ff3d3d');
      m.miss = { x: 240, y: 258, vx: x < 240 ? 160 : -160, vy: -160, a: 0 };
    }
    m.score = s.score;
    m.lives = s.lives;
    m.streakAge += j.dt;
    m.net += j.dt;
    if (s.ball) m.ballY.unshift(s.ball.y);
    else m.ballY.length = 0;
    if (m.ballY.length > 6) m.ballY.pop();

    beginFrame(ctx, j);
    // Court with arena lights that blink on a swish.
    ctx.fillStyle = '#f28a3a';
    ctx.fillRect(0, 0, W, H);
    const lit = Math.max(0, 1 - m.net / 0.5);
    for (let i = 0; i < 9; i++) {
      const lx = 30 + i * 53, ly = 60 + (i % 2) * 30;
      glow(ctx, lx, ly, 34, '#fff3d6', 0.18 + 0.4 * lit * (i % 2 ? 1 : 0.7));
    }
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
    // Aim line: where the ball will rise.
    if (!s.ball) {
      ctx.strokeStyle = '#ffffff30';
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(240, 530);
      ctx.lineTo(240, 280);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Backboard, net (swishes after a score), rim.
    ctx.fillStyle = '#fff';
    rr(ctx, x - 70, 150, 140, 96, 8);
    ctx.strokeStyle = '#ff3d3d';
    ctx.lineWidth = 5;
    ctx.strokeRect(x - 26, 192, 52, 40);
    const sw = m.net < 0.4 ? Math.sin((m.net / 0.4) * Math.PI) * 14 : 0;
    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i * r) / 2.2, 260);
      ctx.lineTo(x + (i * r) / (3.4 + sw * 0.15), 306 + sw);
      ctx.stroke();
    }
    ctx.strokeStyle = lit > 0 ? '#ffd84a' : '#ff3d3d';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(x, 258 + sw * 0.2, r, 9, 0, 0, 7);
    ctx.stroke();
    // Ball: shadow, trail, spin.
    const by = s.ball ? s.ball.y : 560 + Math.sin(s.t * 6) * 3;
    ctx.fillStyle = '#00000022';
    ctx.beginPath();
    ctx.ellipse(240, 590, 26 - (560 - by) * 0.03, 7, 0, 0, 7);
    ctx.fill();
    for (let k = 1; k < m.ballY.length; k++) {
      ctx.globalAlpha = 0.25 * (1 - k / m.ballY.length);
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(240, m.ballY[k]!, 24 - k * 2, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ball(ctx, 240, by, (560 - by) * 0.03);
    if (m.miss) {
      const q = m.miss;
      q.a += j.dt;
      q.vy += 900 * j.dt;
      q.x += q.vx * j.dt;
      q.y += q.vy * j.dt;
      ctx.globalAlpha = Math.max(0, 1 - q.a / 0.8);
      ball(ctx, q.x, q.y, q.a * 9);
      ctx.globalAlpha = 1;
      if (q.a > 0.8) m.miss = null;
    }
    drawBits(ctx, j);
    endFrame(ctx, j);
    // Lives and message.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < s.lives ? '#fff' : '#ffffff40';
      ctx.beginPath();
      ctx.arc(30 + i * 24, 610, 8, 0, 7);
      ctx.fill();
    }
    if (s.mt > 0) {
      const age = 0.5 - s.mt;
      callout(ctx, s.msg, 240, 400, age, s.msg === 'MISS' ? '#7a1f1f' : '#fff', 38);
    }
    if (m.streak >= 2 && m.streakAge < 1.1) callout(ctx, m.streak + ' IN A ROW', 240, 446, m.streakAge, '#ffd84a', 24);
  },
};

function ball(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
  ctx.fillStyle = '#ffb347';
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, 7);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.strokeStyle = '#7a3b0c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-24, 0);
  ctx.lineTo(24, 0);
  ctx.moveTo(0, -24);
  ctx.lineTo(0, 24);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffffff30';
  ctx.beginPath();
  ctx.arc(x - 8, y - 8, 8, 0, 7);
  ctx.fill();
}

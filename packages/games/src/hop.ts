// Hop: bounce up an endless run of platforms. Port of the prototype's DEF.hop.
import { rr, sky } from './draw-util';
import { beginFrame, drawBits, endFrame, juice, pop, ring, shard } from './juice';
import { ramp } from './pace';
import { R, clamp } from './rng';
import { W, type BaseState, type GameDef } from './types';

interface Plat { x: number; y: number; w: number }

export interface HopState extends BaseState {
  x: number;
  y: number;
  vy: number;
  /** Camera top in world coordinates; only ever moves up (gets smaller). */
  cam: number;
  plats: Plat[];
  /** y of the highest platform generated so far. */
  top: number;
}

export const hop: GameDef<HopState> = {
  key: 'hop',
  version: 2,
  // Score is height / 10. A bounce (vy = -580, gravity 1150) rises at most 580^2 / 2300 = 146 px and takes at
  // least 580 / 1150 = 0.504 s before the player can land again: 290 px/s = 29/s. The slack covers one bounce (14.6).
  maxScorePerSecond: 29,
  scoreSlack: 15,

  init(seed) {
    const s: HopState = { score: 0, t: 0, seed, fx: [], x: 240, y: 520, vy: -560, cam: 0, plats: [{ x: 240, y: 560, w: 90 }], top: -200 };
    for (let y = 476; y > -200; y -= 84) s.plats.push({ x: R(s, 60, 420), y, w: 88 });
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    const v = 380;
    if (input.l) s.x -= v * dt;
    if (input.r) s.x += v * dt;
    if (input.ptr) s.x += clamp(input.px - s.x, -v * dt, v * dt);
    if (s.x < -10) s.x = W + 10;
    if (s.x > W + 10) s.x = -10;

    const py = s.y;
    s.vy += 1150 * dt;
    s.y += s.vy * dt;
    if (s.vy > 0) {
      for (const p of s.plats) {
        if (py + 16 <= p.y && s.y + 16 >= p.y && Math.abs(s.x - p.x) < p.w / 2 + 12) {
          s.y = p.y - 16;
          s.vy = -580;
          break;
        }
      }
    }

    s.cam = Math.min(s.cam, s.y - 300);
    s.score = Math.max(0, Math.floor(-s.cam / 10));
    // Version 2: gaps and widths follow a height that opens at 300 and rejoins the real score at 1080
    // (where the width reaches its floor of 56); the gap cap of 58 is unchanged.
    const lv = ramp(s.score, 300, 1080);
    while (s.top > s.cam - 120) {
      s.top -= 62 + Math.min(58, lv / 9) + R(s, 0, 26);
      s.plats.push({ x: R(s, 50, 430), y: s.top, w: Math.max(56, 92 - lv / 30) });
    }
    s.plats = s.plats.filter((p) => p.y < s.cam + 720);
    return s.y > s.cam + 690;
  },

  view(s) {
    const below = s.y - (s.cam + 500);
    return { danger: Math.max(0, Math.min(1, below / 190)) * (s.vy > 0 ? 1 : 0.4), stats: [] };
  },

  draw(ctx, s) {
    const j = juice(s, () => ({ vy: s.vy, squash: 0, mark: 0, land: null as Plat | null, landAge: 9 }));
    const m = j.m;
    // A landing flips vy from falling to the bounce speed.
    if (m.vy > 0 && s.vy < -500) {
      m.squash = 0.14;
      m.landAge = 0;
      m.land = s.plats.find((p) => Math.abs(p.y - (s.y + 16)) < 2) ?? null;
      for (let k = 0; k < 6; k++) shard(j, s.x + (k - 2.5) * 6, s.y + 16, 4, 4, '#ffffffcc', (k - 2.5) * 50, -40 - Math.random() * 60, 0, 0.35, 300);
    }
    m.vy = s.vy;
    m.squash = Math.max(0, m.squash - j.dt);
    m.landAge += j.dt;
    const mark = Math.floor(s.score / 100);
    if (mark > m.mark) {
      m.mark = mark;
      pop(j, 240, 260, mark * 100 + '', '#ff5c8a', 40, 1.1);
      ring(j, s.x, s.y - s.cam, '#ff5c8a', 80, 0.45, 5);
    }

    beginFrame(ctx, j);
    sky(ctx, '#8fe3ff', '#e6fbff');
    // Far mountains sink slowly as the player climbs (parallax), then clouds.
    const sink = Math.min(400, -s.cam * 0.08);
    ctx.fillStyle = '#c9f1ff';
    ctx.beginPath();
    ctx.moveTo(0, 640);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 520 + sink - 60 * Math.abs(Math.sin(x * 0.011 + 1)) - 30 * Math.abs(Math.sin(x * 0.03)));
    ctx.lineTo(W, 640);
    ctx.fill();
    ctx.fillStyle = '#ffffffb0';
    for (let i = 0; i < 5; i++) {
      const y = ((((i * 170 - s.cam * 0.3) % 900) + 900) % 900) - 120;
      ctx.beginPath();
      ctx.ellipse(60 + ((i * 97) % 400), y, 70, 20, 0, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff70';
    for (let i = 0; i < 4; i++) {
      const y = ((((i * 230 - s.cam * 0.55) % 920) + 920) % 920) - 140;
      ctx.beginPath();
      ctx.ellipse(400 - ((i * 131) % 360), y, 40, 12, 0, 0, 7);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(0, -s.cam);
    // Height markers every 100.
    const top = Math.floor(-(s.cam - 40) / 1000), bot = Math.floor(-(s.cam + 680) / 1000);
    ctx.textAlign = 'left';
    ctx.font = '800 14px system-ui';
    for (let k = Math.max(1, bot); k <= top + 1; k++) {
      const y = -k * 1000 + 300;
      ctx.fillStyle = '#ff5c8a55';
      for (let x = 0; x < W; x += 24) ctx.fillRect(x, y, 12, 2);
      ctx.fillStyle = '#ff5c8a';
      ctx.fillText(k * 100 + '', 8, y - 6);
    }
    for (const p of s.plats) {
      const dip = p === m.land && m.landAge < 0.18 ? Math.sin((m.landAge / 0.18) * Math.PI) * 6 : 0;
      ctx.fillStyle = '#0c5a3e22';
      rr(ctx, p.x - p.w / 2 + 3, p.y + 6 + dip, p.w, 12, 6);
      ctx.fillStyle = '#18b77f';
      rr(ctx, p.x - p.w / 2, p.y + dip, p.w, 14, 7);
      ctx.fillStyle = '#5fe0b0';
      rr(ctx, p.x - p.w / 2 + 6, p.y + 2 + dip, p.w - 12, 4, 2);
    }
    // Player: squashes on landing, stretches with speed.
    const st = m.squash > 0 ? -0.28 * (m.squash / 0.14) : Math.min(0.18, Math.abs(s.vy) / 3200);
    const sx = 1 - st * 0.8, sy = 1 + st;
    if (s.vy < -380) {
      ctx.fillStyle = '#ff5c8a33';
      rr(ctx, s.x - 14, s.y - 4, 28, 40, 12);
    }
    ctx.save();
    ctx.translate(s.x, s.y + 16);
    ctx.scale(sx, sy);
    ctx.translate(-s.x, -(s.y + 16));
    ctx.fillStyle = '#ff5c8a';
    rr(ctx, s.x - 17, s.y - 24, 34, 40, 13);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x - 6, s.y - 10, 5, 0, 7);
    ctx.arc(s.x + 7, s.y - 10, 5, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#0c0f26';
    const look = s.vy > 0 ? 2 : -1;
    ctx.beginPath();
    ctx.arc(s.x - 5, s.y - 10 + look, 2, 0, 7);
    ctx.arc(s.x + 8, s.y - 10 + look, 2, 0, 7);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.save();
    ctx.translate(0, -s.cam);
    drawBits(ctx, j);
    ctx.restore();
    endFrame(ctx, j);
  },
};

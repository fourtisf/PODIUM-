// Hop: bounce up an endless run of platforms. Port of the prototype's DEF.hop.
import { rr, sky } from './draw-util';
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

  draw(ctx, s) {
    sky(ctx, '#8fe3ff', '#e6fbff');
    // Clouds.
    ctx.fillStyle = '#ffffffb0';
    for (let i = 0; i < 5; i++) {
      const y = ((((i * 170 - s.cam * 0.3) % 900) + 900) % 900) - 120;
      ctx.beginPath();
      ctx.ellipse(60 + ((i * 97) % 400), y, 70, 20, 0, 0, 7);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(0, -s.cam);
    for (const p of s.plats) {
      ctx.fillStyle = '#18b77f';
      rr(ctx, p.x - p.w / 2, p.y, p.w, 14, 7);
      ctx.fillStyle = '#5fe0b0';
      rr(ctx, p.x - p.w / 2 + 6, p.y + 2, p.w - 12, 4, 2);
    }
    // Player.
    ctx.fillStyle = '#ff5c8a';
    rr(ctx, s.x - 17, s.y - 24, 34, 40, 13);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x - 6, s.y - 10, 5, 0, 7);
    ctx.arc(s.x + 7, s.y - 10, 5, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#0c0f26';
    ctx.beginPath();
    ctx.arc(s.x - 5, s.y - 10, 2, 0, 7);
    ctx.arc(s.x + 8, s.y - 10, 2, 0, 7);
    ctx.fill();
    ctx.restore();
  },
};

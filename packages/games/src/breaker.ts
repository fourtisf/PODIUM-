// Brick Breaker. Port of the prototype's DEF.breaker (prototype/podium-v9.html).
import { PUC, capsule, rr, sky } from './draw-util';
import { beginFrame, drawBits, endFrame, glow, juice, kickFlash, ring, shard, sparks } from './juice';
import { R, clamp, rnd } from './rng';
import { W, type BaseState, type DrawEnv, type Fx, type GameDef, type Input } from './types';

interface Brick { x: number; y: number; w: number; h: number; hp: number; /** Row, picks the colour. */ r: number; /** Hit flash, seconds left. */ hit: number }
interface Ball { x: number; y: number; vx: number; vy: number; /** Seconds left on the paddle before auto-launch; 0 once in flight. */ stuck: number }

/** Wide paddle, Multi-ball, Slow ball, extra Life. */
type PowerKind = 'W' | 'M' | 'S' | 'L';
interface PowerUp { x: number; y: number; k: PowerKind }

export interface BreakerState extends BaseState {
  /** Paddle centre and current width. */
  px: number;
  pw: number;
  level: number;
  lives: number;
  bricks: Brick[];
  balls: Ball[];
  pu: PowerUp[];
  wide: number;
  slow: number;
  combo: number;
  shake: number;
}

const COL = ['#ff4f81', '#ff8a3c', '#ffd84a', '#7af0c5', '#7dd3fc', '#a79bff', '#ff8fd0', '#ff4f81', '#ff8a3c'];
const POWER_KINDS: readonly PowerKind[] = ['W', 'M', 'S', 'L'];

/** Bricks for a level: full grid, checkerboard or pyramid, cycling every three levels. */
function layoutBricks(level: number): Brick[] {
  const bricks: Brick[] = [];
  const L = level;
  const rows = Math.min(9, 4 + Math.floor(L / 2));
  const pat = L % 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 8; c++) {
      if (pat === 2 && (r + c) % 2) continue;
      if (pat === 0 && (c < r - rows + 4 || c > 7 - (r - rows + 4))) continue;
      bricks.push({ x: 14 + c * 57, y: 150 + r * 26, w: 53, h: 22, hp: L > 1 && r < Math.min(3, L - 1) ? 2 : 1, r, hit: 0 });
    }
  }
  return bricks;
}

function layout(s: BreakerState): void {
  s.bricks = layoutBricks(s.level);
}

function reset(s: BreakerState): void {
  s.balls = [{ x: s.px, y: 575, vx: 0, vy: 0, stuck: 1 }];
}

function init(seed: number): BreakerState {
  const s: BreakerState = {
    score: 0, t: 0, seed, fx: [],
    px: 240, pw: 92, level: 1, lives: 3, bricks: [], balls: [], pu: [],
    wide: 0, slow: 0, combo: 0, shake: 0,
  };
  layout(s);
  reset(s);
  return s;
}

function update(s: BreakerState, input: Input, dt: number): boolean {
  s.t += dt;
  s.wide = Math.max(0, s.wide - dt);
  s.slow = Math.max(0, s.slow - dt);
  s.shake = Math.max(0, s.shake - dt * 1.8);
  const press = input.presses.length > 0;

  // Paddle.
  const tw = s.wide > 0 ? 136 : 92;
  s.pw += (tw - s.pw) * Math.min(1, dt * 10);
  const v = 520;
  if (input.l) s.px -= v * dt;
  if (input.r) s.px += v * dt;
  if (input.ptr) s.px += clamp(input.px - s.px, -v * 1.6 * dt, v * 1.6 * dt);
  s.px = clamp(s.px, s.pw / 2 + 4, W - s.pw / 2 - 4);

  const sp = (325 + s.level * 16) * (s.slow > 0 ? 0.62 : 1);

  // Balls.
  for (let i = s.balls.length - 1; i >= 0; i--) {
    const b = s.balls[i]!;
    if (b.stuck > 0) {
      b.x = s.px;
      b.y = 575;
      b.stuck -= dt;
      if (b.stuck <= 0 || (press && b.stuck < 0.8)) {
        b.stuck = 0;
        const a = R(s, -0.45, 0.45);
        b.vx = sp * Math.sin(a);
        b.vy = -sp * Math.cos(a);
      }
      continue;
    }
    const m = Math.hypot(b.vx, b.vy) || 1;
    b.vx = (b.vx / m) * sp;
    b.vy = (b.vy / m) * sp;
    if (Math.abs(b.vy) < sp * 0.22) b.vy = (b.vy < 0 ? -1 : 1) * sp * 0.22;

    for (let n = 0; n < 3; n++) {
      b.x += (b.vx * dt) / 3;
      b.y += (b.vy * dt) / 3;
      if (b.x < 7) { b.x = 7; b.vx = Math.abs(b.vx); }
      if (b.x > W - 7) { b.x = W - 7; b.vx = -Math.abs(b.vx); }
      if (b.y < 127) { b.y = 127; b.vy = Math.abs(b.vy); }

      // Paddle.
      if (b.vy > 0 && b.y + 7 >= 590 && b.y + 7 <= 610 && Math.abs(b.x - s.px) < s.pw / 2 + 7) {
        const a = clamp((b.x - s.px) / (s.pw / 2), -1, 1) * 1.05;
        b.vx = sp * Math.sin(a);
        b.vy = -sp * Math.cos(a);
        b.y = 583;
        s.combo = 0;
        s.fx.push({ k: 'beep', f: 330, d: 0.05, w: 'square', v: 0.03 });
      }

      // Bricks: at most one per sub-step.
      for (let j = 0; j < s.bricks.length; j++) {
        const k = s.bricks[j]!;
        if (b.x + 7 > k.x && b.x - 7 < k.x + k.w && b.y + 7 > k.y && b.y - 7 < k.y + k.h) {
          const ox = Math.min(b.x + 7 - k.x, k.x + k.w - (b.x - 7));
          const oy = Math.min(b.y + 7 - k.y, k.y + k.h - (b.y - 7));
          if (ox < oy) b.vx = (b.x < k.x + k.w / 2 ? -1 : 1) * Math.abs(b.vx);
          else b.vy = (b.y < k.y + k.h / 2 ? -1 : 1) * Math.abs(b.vy);
          k.hp--;
          k.hit = 0.1;
          if (k.hp <= 0) {
            s.bricks.splice(j, 1);
            s.score += 10 * Math.min(8, 1 + s.combo);
            s.combo++;
            s.fx.push({ k: 'burst', x: k.x + k.w / 2, y: k.y + k.h / 2, c: COL[k.r % COL.length]!, n: 12, sp: 200 });
            s.shake = Math.max(s.shake, 0.08);
            s.fx.push({ k: 'beep', f: 440 + Math.min(600, s.combo * 40), d: 0.06, w: 'triangle', v: 0.04 });
            if (rnd(s) < 0.15) {
              const kind = POWER_KINDS[rnd(s) < 0.08 ? 3 : Math.floor(rnd(s) * 3)]!;
              s.pu.push({ x: k.x + k.w / 2, y: k.y, k: kind });
            }
          } else {
            s.fx.push({ k: 'beep', f: 240, d: 0.05, w: 'square', v: 0.03 });
          }
          break;
        }
      }
    }
    if (b.y > 664) s.balls.splice(i, 1);
  }

  // All balls lost.
  if (!s.balls.length) {
    s.lives--;
    s.shake = 0.45;
    s.fx.push({ k: 'beep', f: 140, d: 0.3, w: 'sawtooth', v: 0.06, slide: -70 });
    if (s.lives <= 0) return true;
    s.combo = 0;
    reset(s);
  }

  // Level cleared.
  if (!s.bricks.length) {
    s.score += 100 * s.level;
    s.level++;
    s.fx.push({ k: 'text', t: 'Level ' + s.level });
    // The prototype plays the second note 110 ms later (setTimeout); here both are queued in the same step.
    s.fx.push({ k: 'beep', f: 660, d: 0.12, w: 'sine', v: 0.06 });
    s.fx.push({ k: 'beep', f: 880, d: 0.2, w: 'sine', v: 0.06 });
    layout(s);
    reset(s);
    s.pu = [];
  }

  // Power-ups.
  for (let i = s.pu.length - 1; i >= 0; i--) {
    const p = s.pu[i]!;
    p.y += 135 * dt;
    if (p.y > 670) {
      s.pu.splice(i, 1);
      continue;
    }
    if (p.y > 580 && p.y < 612 && Math.abs(p.x - s.px) < s.pw / 2 + 14) {
      s.pu.splice(i, 1);
      s.fx.push({ k: 'beep', f: 700, d: 0.1, w: 'sine', v: 0.06 });
      if (p.k === 'W') {
        s.wide = 12;
        s.fx.push({ k: 'text', t: 'Wide paddle' });
      } else if (p.k === 'S') {
        s.slow = 8;
        s.fx.push({ k: 'text', t: 'Slow ball' });
      } else if (p.k === 'L') {
        s.lives = Math.min(5, s.lives + 1);
        s.fx.push({ k: 'text', t: 'Extra life' });
      } else {
        s.fx.push({ k: 'text', t: 'Multi-ball' });
        const add: Ball[] = [];
        for (const b of s.balls) {
          if (b.stuck > 0) continue;
          for (const a of [-0.45, 0.45]) {
            const c = Math.cos(a), n = Math.sin(a);
            add.push({ x: b.x, y: b.y, vx: b.vx * c - b.vy * n, vy: b.vx * n + b.vy * c, stuck: 0 });
          }
        }
        s.balls.push(...add);
        if (s.balls.length > 12) s.balls.length = 12;
      }
    }
  }

  for (const k of s.bricks) if (k.hit) k.hit = Math.max(0, k.hit - dt);
  return false;
}

/** Visual-only noise in [0, 1) derived from the play clock (stands in for the prototype's Math.random() in draw). */
function noise(t: number, k: number): number {
  const v = Math.sin(t * 997 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function draw(ctx: CanvasRenderingContext2D, s: BreakerState, env: DrawEnv): void {
  const j = juice(s, () => ({ bricks: new Set<Brick>(), vy: new WeakMap<Ball, number>(), trail: new WeakMap<Ball, [number, number][]>(), pad: 9, lives: s.lives, level: s.level }));
  const m = j.m;
  // Broken bricks shatter; a ball bouncing off the paddle squashes it (display only).
  for (const k of m.bricks) {
    if (s.bricks.includes(k) || s.level !== m.level) continue;
    const c = COL[k.r % COL.length]!;
    for (let i = 0; i < 4; i++) shard(j, k.x + 7 + i * 13, k.y + k.h / 2, 12, 9, c, (i - 1.5) * 60 + (Math.random() - 0.5) * 80, -80 - Math.random() * 120, (Math.random() - 0.5) * 12, 0.7, 900);
    ring(j, k.x + k.w / 2, k.y + k.h / 2, c, 36, 0.25, 3);
  }
  if (s.level > m.level) kickFlash(j, 0.5, '#ffffff');
  if (s.lives < m.lives) kickFlash(j, 0.35, '#ff2a50');
  m.level = s.level;
  m.lives = s.lives;
  m.bricks = new Set(s.bricks);
  for (const b of s.balls) {
    const pv = m.vy.get(b);
    if (pv !== undefined && pv > 0 && b.vy < 0 && b.y > 560) {
      m.pad = 0;
      sparks(j, b.x, 590, '#7af0c5', 6, 200);
    }
    m.vy.set(b, b.vy);
    const tr = m.trail.get(b) ?? [];
    if (j.dt > 0) tr.unshift([b.x, b.y]);
    if (tr.length > 8) tr.pop();
    m.trail.set(b, tr);
  }
  m.pad += j.dt;
  beginFrame(ctx, j);
  sky(ctx, '#0a0c28', '#1c1458');
  glow(ctx, 240, 380, 300, '#6c5cff', 0.12 + Math.min(0.15, s.combo * 0.015));
  ctx.save();
  if (s.shake > 0) ctx.translate((noise(s.t, 1) - 0.5) * s.shake * 16, (noise(s.t, 2) - 0.5) * s.shake * 16);

  // Back wall.
  ctx.fillStyle = '#ffffff10';
  for (let i = 0; i < 9; i++) ctx.fillRect(i * 60, 120, 1, 520);
  ctx.fillStyle = '#ffffff30';
  ctx.fillRect(0, 118, W, 2);

  for (const k of s.bricks) {
    const c = COL[k.r % COL.length]!;
    ctx.fillStyle = k.hit ? '#fff' : c;
    rr(ctx, k.x, k.y, k.w, k.h, 6);
    ctx.fillStyle = '#ffffff40';
    rr(ctx, k.x + 3, k.y + 2, k.w - 6, 6, 3);
    ctx.fillStyle = '#00000030';
    rr(ctx, k.x, k.y + k.h - 6, k.w, 6, 3);
    if (k.hp > 1) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(k.x + 1, k.y + 1, k.w - 2, k.h - 2, 6);
      ctx.stroke();
    }
  }

  for (const p of s.pu) capsule(ctx, p.x, p.y, p.k, PUC[p.k]!);

  // Paddle (squashes for a moment when the ball bounces off it).
  const sq = m.pad < 0.12 ? Math.sin((m.pad / 0.12) * Math.PI) : 0;
  ctx.save();
  ctx.translate(s.px, 597);
  ctx.scale(1 + sq * 0.12, 1 - sq * 0.3);
  ctx.translate(-s.px, -597);
  ctx.fillStyle = '#7af0c540';
  rr(ctx, s.px - s.pw / 2 - 4, 586, s.pw + 8, 22, 11);
  ctx.fillStyle = s.wide > 0 ? '#7af0c5' : '#fff';
  rr(ctx, s.px - s.pw / 2, 590, s.pw, 14, 7);
  ctx.fillStyle = '#ff4f81';
  rr(ctx, s.px - s.pw / 2, 590, 14, 14, 7);
  rr(ctx, s.px + s.pw / 2 - 14, 590, 14, 14, 7);
  ctx.restore();

  for (const b of s.balls) {
    const tr = m.trail.get(b) ?? [];
    for (let k = 1; k < tr.length; k++) {
      ctx.globalAlpha = 0.3 * (1 - k / tr.length);
      ctx.fillStyle = s.slow > 0 ? '#7dd3fc' : '#ffffff';
      ctx.beginPath();
      ctx.arc(tr[k]![0], tr[k]![1], 7 * (1 - k / tr.length / 1.5), 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff30';
    ctx.beginPath();
    ctx.arc(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 6, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc55';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 12, 0, 7);
    ctx.fill();
    ctx.fillStyle = s.slow > 0 ? '#7dd3fc' : '#fff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, 7);
    ctx.fill();
  }

  drawBits(ctx, j);
  env.fxDraw();
  ctx.restore();

  // HUD.
  for (let i = 0; i < s.lives; i++) {
    ctx.fillStyle = '#ff4f81';
    ctx.beginPath();
    ctx.arc(20 + i * 20, 624, 6, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffffb0';
  ctx.font = '700 14px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText('Level ' + s.level, 466, 629);
  if (s.combo >= 3) {
    ctx.fillStyle = '#ffd84a';
    ctx.font = '800 18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('x' + Math.min(8, 1 + s.combo), 240, 629);
  }
  endFrame(ctx, j);
}

export const breaker: GameDef<BreakerState> = {
  key: 'breaker',
  version: 1,
  ownFx: true,
  // A brick is worth 10 x min(8, 1 + combo) <= 80 and clearing level L adds 100 x L, so a level yields at most
  // 80 x bricks + 100 x L (bricks <= 72). The least time a level can take:
  // - 0.2 s before the ball can be launched (stuck must drop from 1 below 0.8),
  // - the flight from the paddle (y 575) to the lowest row: (422 - 26 x rows) px at no more than 325 + 16 x L px/s,
  // - one brick contact per collision sub-step (3 per frame = 180 per second) for the single ball; a multi-ball
  //   capsule needs over 1.6 s to fall to the paddle and capsules are wiped on every level change.
  // That is 0.8 to 1.3 s per level, and the worst score/time ratio over levels 1..30 is 8 700 per second
  // (level 30: 7 800 points in 0.90 s); the cumulative ratio stays below 9 000 up to about level 60.
  // There is no true constant: the level bonus and the ball speed both grow with the level without limit,
  // so this bound is only valid for runs up to about level 60 (tracking bots reach level 15 in 30 minutes).
  maxScorePerSecond: 9000,
  scoreSlack: 0,
  init,
  update,
  draw,
  view(s) {
    let danger = s.lives === 1 ? 0.3 : 0;
    const live = s.balls.filter((b) => !b.stuck);
    if (live.length) {
      const low = live.reduce((a, b) => (b.y > a.y ? b : a));
      if (low.vy > 0 && low.y > 470 && Math.abs(low.x - s.px) > s.pw / 2 + 8) danger = Math.max(danger, Math.min(1, (low.y - 470) / 110));
    }
    const mult = Math.min(8, 1 + s.combo);
    return { danger, mult, stats: [{ k: 'level', v: s.level }, { k: 'combo', v: mult }, { k: 'lives', v: s.lives }] };
  },
  impact: (f: Fx) => (f.k === 'beep' && f.w === 'sawtooth' ? 0.6 : 0),
};

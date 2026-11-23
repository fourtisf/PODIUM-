// Star Blaster. Port of the prototype's DEF.blaster (prototype/podium-v9.html).
import { PUC, capsule, rr, sky } from './draw-util';
import { R, clamp, rnd } from './rng';
import { W, type BaseState, type DrawEnv, type GameDef, type Input } from './types';

interface Bullet { x: number; y: number; vx: number }
interface EnemyBullet { x: number; y: number; vx: number; vy: number }

interface EnemyBase { x: number; y: number; hp: number; pts: number; c: string; /** Hit flash, seconds left. */ hit: number }
/** Grunt: drifts down on a sine. */
interface Grunt extends EnemyBase { k: 'g'; ph: number; vy: number }
/** Shooter: descends to ty, then strafes and fires aimed shots. */
interface Shooter extends EnemyBase { k: 's'; ty: number; cd: number; dir: number }
/** Diver: accelerates down, homing on the player. */
interface Diver extends EnemyBase { k: 'd'; vy: number }
/** Boss: every fifth wave. */
interface Boss extends EnemyBase { k: 'b'; max: number; cd: number; ph: number }
type Enemy = Grunt | Shooter | Diver | Boss;

type PowerKind = 'S' | 'R' | 'H';
interface PowerUp { x: number; y: number; k: PowerKind }

export interface BlasterState extends BaseState {
  x: number;
  fire: number;
  bul: Bullet[];
  en: Enemy[];
  eb: EnemyBullet[];
  pu: PowerUp[];
  wave: number;
  /** Enemies still to spawn in the current wave. */
  left: number;
  spawnT: number;
  banner: number;
  lives: number;
  inv: number;
  /** Shield held (0 | 1). */
  sh: number;
  spread: number;
  rapid: number;
  combo: number;
  /** Combo timer. */
  ct: number;
  shake: number;
}

const POWER_KINDS: readonly PowerKind[] = ['S', 'R', 'H'];
const SHIP_Y = 560;

function kill(s: BlasterState, e: Enemy): void {
  const boss = e.k === 'b';
  const m = Math.min(8, 1 + Math.floor(s.combo / 4));
  s.score += e.pts * m;
  s.combo++;
  s.ct = 1.7;
  s.fx.push({ k: 'burst', x: e.x, y: e.y, c: e.c, n: boss ? 70 : 16, sp: boss ? 340 : 190 });
  s.fx.push({ k: 'burst', x: e.x, y: e.y, c: '#fff', n: boss ? 20 : 5, sp: 120 });
  s.shake = Math.max(s.shake, boss ? 0.6 : 0.12);
  s.fx.push({ k: 'beep', f: boss ? 90 : 170, d: boss ? 0.5 : 0.14, w: 'sawtooth', v: 0.05, slide: -90 });
  if (boss) {
    s.pu.push({ x: e.x - 30, y: e.y, k: 'S' }, { x: e.x + 30, y: e.y, k: 'H' });
    s.fx.push({ k: 'text', t: 'Boss down' });
  } else if (rnd(s) < 0.14) {
    s.pu.push({ x: e.x, y: e.y, k: POWER_KINDS[Math.floor(rnd(s) * 3)]! });
  }
}

/** Returns true when the last life is lost. */
function hurt(s: BlasterState): boolean {
  if (s.inv > 0) return false;
  if (s.sh) {
    s.sh = 0;
    s.inv = 1;
    s.fx.push({ k: 'burst', x: s.x, y: SHIP_Y, c: '#7dd3fc', n: 24, sp: 220 });
    s.fx.push({ k: 'beep', f: 300, d: 0.2, w: 'triangle', v: 0.05, slide: -120 });
    return false;
  }
  s.lives--;
  s.inv = 1.8;
  s.shake = 0.5;
  s.combo = 0;
  s.fx.push({ k: 'burst', x: s.x, y: SHIP_Y, c: '#fff', n: 30, sp: 260 });
  s.fx.push({ k: 'beep', f: 120, d: 0.3, w: 'square', v: 0.06, slide: -60 });
  return s.lives <= 0;
}

function init(seed: number): BlasterState {
  return {
    score: 0, t: 0, seed, fx: [],
    x: 240, fire: 0, bul: [], en: [], eb: [], pu: [],
    wave: 0, left: 0, spawnT: 0, banner: 0,
    lives: 3, inv: 0, sh: 0, spread: 0, rapid: 0, combo: 0, ct: 0, shake: 0,
  };
}

function update(s: BlasterState, input: Input, dt: number): boolean {
  s.t += dt;
  s.inv = Math.max(0, s.inv - dt);
  s.spread = Math.max(0, s.spread - dt);
  s.rapid = Math.max(0, s.rapid - dt);
  s.banner = Math.max(0, s.banner - dt);
  s.ct = Math.max(0, s.ct - dt);
  s.shake = Math.max(0, s.shake - dt * 1.6);
  if (s.ct <= 0) s.combo = 0;

  // Movement (the ship fires by itself; presses are ignored).
  const v = 390;
  if (input.l) s.x -= v * dt;
  if (input.r) s.x += v * dt;
  if (input.ptr) s.x += clamp(input.px - s.x, -v * 1.4 * dt, v * 1.4 * dt);
  s.x = clamp(s.x, 24, W - 24);

  // Next wave.
  if (s.left === 0 && s.en.length === 0) {
    s.wave++;
    s.banner = 1.5;
    if (s.wave % 5 === 0) {
      const hp = 36 + s.wave * 5;
      s.en.push({ k: 'b', x: 240, y: -70, hp, max: hp, pts: 300, c: '#ff8a3c', cd: 1.4, ph: 0, hit: 0 });
      s.fx.push({ k: 'beep', f: 110, d: 0.5, w: 'sawtooth', v: 0.05, slide: 60 });
    } else {
      s.left = 5 + Math.floor(s.wave * 1.5);
      s.spawnT = 1.1;
    }
  }

  // Spawning.
  if (s.left > 0) {
    s.spawnT -= dt;
    if (s.spawnT <= 0) {
      s.left--;
      s.spawnT = Math.max(0.26, 0.85 - s.wave * 0.035);
      const r = rnd(s);
      const x = R(s, 40, 440);
      const w = s.wave;
      if (w >= 3 && r > 0.8) {
        s.en.push({ k: 'd', x, y: -20, hp: 1, pts: 15, c: '#a79bff', vy: 110, hit: 0 });
      } else if (w >= 2 && r > 0.5) {
        const ty = R(s, 150, 260);
        const cd = R(s, 0.6, 1.5);
        const dir = rnd(s) < 0.5 ? -1 : 1;
        s.en.push({ k: 's', x, y: -20, hp: 2 + Math.floor(w / 6), pts: 25, c: '#ffd84a', ty, cd, dir, hit: 0 });
      } else {
        const ph = R(s, 0, 6);
        s.en.push({ k: 'g', x, y: -20, hp: 1, pts: 10, c: '#ff4f81', ph, vy: 72 + w * 5, hit: 0 });
      }
    }
  }

  // Enemies.
  for (let i = s.en.length - 1; i >= 0; i--) {
    const e = s.en[i]!;
    if (e.k === 'g') {
      e.y += e.vy * dt;
      e.x += Math.sin(s.t * 2.2 + e.ph) * 70 * dt;
    } else if (e.k === 's') {
      if (e.y < e.ty) {
        e.y += 130 * dt;
      } else {
        e.x += e.dir * 74 * dt;
        if (e.x < 40 || e.x > 440) e.dir *= -1;
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = Math.max(0.8, 1.8 - s.wave * 0.05);
          const a = Math.atan2(SHIP_Y - e.y, s.x - e.x);
          s.eb.push({ x: e.x, y: e.y + 14, vx: Math.cos(a) * 235, vy: Math.sin(a) * 235 });
        }
      }
    } else if (e.k === 'd') {
      if (e.y > 110) e.vy = Math.min(540, e.vy + 760 * dt);
      e.y += e.vy * dt;
      if (e.y < 420) e.x += clamp(s.x - e.x, -1, 1) * 150 * dt;
    } else {
      if (e.y < 132) {
        e.y += 70 * dt;
      } else {
        e.ph += dt;
        e.x = 240 + 172 * Math.sin(e.ph * 0.8);
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = Math.max(0.75, 1.5 - s.wave * 0.03);
          for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) {
            s.eb.push({ x: e.x, y: e.y + 40, vx: Math.sin(a) * 215, vy: Math.cos(a) * 215 });
          }
        }
      }
    }
    if (e.y > 680) {
      s.en.splice(i, 1);
      continue;
    }
    const boss = e.k === 'b';
    const rad = boss ? 46 : 24;
    if (Math.abs(e.x - s.x) < rad && Math.abs(e.y - SHIP_Y) < rad) {
      if (!boss) {
        s.fx.push({ k: 'burst', x: e.x, y: e.y, c: e.c, n: 12 });
        s.en.splice(i, 1);
      }
      if (hurt(s)) return true;
    }
  }

  // Auto-fire.
  s.fire -= dt;
  if (s.fire <= 0) {
    s.fire = s.rapid > 0 ? 0.095 : 0.19;
    s.bul.push({ x: s.x, y: 538, vx: 0 });
    if (s.spread > 0) s.bul.push({ x: s.x - 8, y: 544, vx: -150 }, { x: s.x + 8, y: 544, vx: 150 });
  }

  // Player bullets.
  for (let i = s.bul.length - 1; i >= 0; i--) {
    const b = s.bul[i]!;
    b.y -= 660 * dt;
    b.x += b.vx * dt;
    if (b.y < 110) {
      s.bul.splice(i, 1);
      continue;
    }
    for (let j = s.en.length - 1; j >= 0; j--) {
      const e = s.en[j]!;
      const rad = e.k === 'b' ? 44 : 19;
      if (Math.abs(b.x - e.x) < rad && Math.abs(b.y - e.y) < rad) {
        s.bul.splice(i, 1);
        e.hp--;
        e.hit = 0.08;
        s.fx.push({ k: 'burst', x: b.x, y: b.y, c: '#fff', n: 3, sp: 90 });
        if (e.hp <= 0) {
          kill(s, e);
          s.en.splice(j, 1);
        }
        break;
      }
    }
  }

  // Enemy bullets.
  for (let i = s.eb.length - 1; i >= 0; i--) {
    const b = s.eb[i]!;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y > 660 || b.x < -20 || b.x > 500) {
      s.eb.splice(i, 1);
      continue;
    }
    if (Math.abs(b.x - s.x) < 15 && Math.abs(b.y - SHIP_Y) < 17) {
      s.eb.splice(i, 1);
      if (hurt(s)) return true;
    }
  }

  // Power-ups.
  for (let i = s.pu.length - 1; i >= 0; i--) {
    const p = s.pu[i]!;
    p.y += 115 * dt;
    if (p.y > 670) {
      s.pu.splice(i, 1);
      continue;
    }
    if (Math.abs(p.x - s.x) < 30 && Math.abs(p.y - SHIP_Y) < 28) {
      s.pu.splice(i, 1);
      // The prototype plays the second note 80 ms later (setTimeout); here both are queued in the same step.
      s.fx.push({ k: 'beep', f: 660, d: 0.1, w: 'sine', v: 0.06 });
      s.fx.push({ k: 'beep', f: 990, d: 0.14, w: 'sine', v: 0.06 });
      if (p.k === 'S') {
        s.spread = 10;
        s.fx.push({ k: 'text', t: 'Spread shot' });
      } else if (p.k === 'R') {
        s.rapid = 10;
        s.fx.push({ k: 'text', t: 'Rapid fire' });
      } else {
        s.sh = 1;
        s.fx.push({ k: 'text', t: 'Shield up' });
      }
    }
  }

  for (const e of s.en) if (e.hit) e.hit = Math.max(0, e.hit - dt);
  return false;
}

/** Visual-only noise in [0, 1) derived from the play clock (stands in for the prototype's Math.random() in draw). */
function noise(t: number, k: number): number {
  const v = Math.sin(t * 997 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function draw(ctx: CanvasRenderingContext2D, s: BlasterState, env: DrawEnv): void {
  sky(ctx, '#04051a', '#1b1150');
  ctx.save();
  if (s.shake > 0) ctx.translate((noise(s.t, 1) - 0.5) * s.shake * 18, (noise(s.t, 2) - 0.5) * s.shake * 18);

  // Star field.
  for (let i = 0; i < 70; i++) {
    const sp = 18 + (i % 4) * 34;
    const y = ((i * 53 + s.t * sp) % 660) - 10;
    const x = (i * 97) % 480;
    ctx.fillStyle = i % 7 ? '#ffffff' : '#7dd3fc';
    ctx.globalAlpha = 0.25 + (i % 4) * 0.18;
    ctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 3) * (1 + sp / 60));
  }
  ctx.globalAlpha = 1;

  for (const b of s.bul) {
    ctx.fillStyle = '#7af0c544';
    rr(ctx, b.x - 5, b.y - 12, 10, 24, 5);
    ctx.fillStyle = '#d9fff2';
    rr(ctx, b.x - 2, b.y - 9, 4, 18, 2);
  }

  for (const e of s.en) {
    ctx.fillStyle = e.hit ? '#fff' : e.c;
    if (e.k === 'g') {
      ctx.beginPath();
      ctx.moveTo(e.x, e.y + 18);
      ctx.lineTo(e.x - 18, e.y - 4);
      ctx.lineTo(e.x - 9, e.y - 16);
      ctx.lineTo(e.x + 9, e.y - 16);
      ctx.lineTo(e.x + 18, e.y - 4);
      ctx.fill();
      ctx.fillStyle = '#0a0d24';
      ctx.beginPath();
      ctx.arc(e.x, e.y - 2, 5, 0, 7);
      ctx.fill();
    } else if (e.k === 's') {
      rr(ctx, e.x - 19, e.y - 13, 38, 24, 8);
      ctx.fillRect(e.x - 4, e.y + 8, 8, 12);
      ctx.fillStyle = '#0a0d24';
      rr(ctx, e.x - 11, e.y - 7, 22, 8, 4);
    } else if (e.k === 'd') {
      ctx.beginPath();
      ctx.moveTo(e.x, e.y + 22);
      ctx.lineTo(e.x - 14, e.y - 16);
      ctx.lineTo(e.x, e.y - 7);
      ctx.lineTo(e.x + 14, e.y - 16);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, 58, 26, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = e.hit ? '#fff' : '#ffd0a0';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y - 14, 30, 20, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#0a0d24';
      for (const o of [-34, -12, 12, 34]) {
        ctx.beginPath();
        ctx.arc(e.x + o, e.y + 6, 5, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff30';
      rr(ctx, e.x - 60, e.y - 52, 120, 7, 4);
      ctx.fillStyle = '#ff4f81';
      rr(ctx, e.x - 60, e.y - 52, (120 * e.hp) / e.max, 7, 4);
    }
  }

  for (const b of s.eb) {
    ctx.fillStyle = '#ff8a3c66';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 9, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#fff3d0';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, 7);
    ctx.fill();
  }

  for (const p of s.pu) capsule(ctx, p.x, p.y, p.k, PUC[p.k]!);

  // Ship (blinks while invulnerable).
  if (!(s.inv > 0 && Math.floor(s.t * 18) % 2)) {
    const x = s.x, y = SHIP_Y;
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 16);
    ctx.lineTo(x, y + 30 + noise(s.t, 3) * 12);
    ctx.lineTo(x + 7, y + 16);
    ctx.fill();
    ctx.fillStyle = '#7af0c5';
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x - 24, y + 18);
    ctx.lineTo(x - 8, y + 12);
    ctx.lineTo(x + 8, y + 12);
    ctx.lineTo(x + 24, y + 18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x, y - 26);
    ctx.lineTo(x - 10, y + 14);
    ctx.lineTo(x + 10, y + 14);
    ctx.fill();
    ctx.fillStyle = '#1a1e72';
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x - 4, y + 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.fill();
    if (s.sh) {
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(s.t * 8);
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  env.fxDraw();
  ctx.restore();

  // HUD.
  for (let i = 0; i < s.lives; i++) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(22 + i * 22, 606);
    ctx.lineTo(14 + i * 22, 622);
    ctx.lineTo(30 + i * 22, 622);
    ctx.fill();
  }
  let bx = 466;
  const bars: [PowerKind, number][] = [['S', s.spread], ['R', s.rapid]];
  for (const [k, v] of bars) {
    if (v > 0) {
      ctx.fillStyle = '#ffffff25';
      rr(ctx, bx - 64, 608, 64, 12, 6);
      ctx.fillStyle = PUC[k]!;
      rr(ctx, bx - 64, 608, (64 * v) / 10, 12, 6);
      bx -= 72;
    }
  }
  if (s.combo >= 4) {
    ctx.fillStyle = '#ffd84a';
    ctx.font = '800 20px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('COMBO x' + Math.min(8, 1 + Math.floor(s.combo / 4)), 240, 600);
  }
  if (s.banner > 0) {
    ctx.globalAlpha = Math.min(1, s.banner * 1.4);
    ctx.fillStyle = '#fff';
    ctx.font = '800 40px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(s.wave % 5 === 0 ? 'BOSS' : 'WAVE ' + s.wave, 240, 330);
    ctx.globalAlpha = 1;
  }
}

export const blaster: GameDef<BlasterState> = {
  key: 'blaster',
  version: 1,
  ownFx: true,
  // Score only comes from kills, and kills are limited by how fast enemies can appear.
  // - Normal enemies: one spawn per max(0.26, 0.85 - 0.035 * wave) s, so at most 1 / 0.26 per second.
  //   The best one is a shooter (25 pts) at the x8 combo cap: 200 / 0.26 = 770 per second.
  // - Bosses: 300 x 8 = 2400, one every fifth wave. The four waves in between hold at least 6 enemies
  //   each and need 1.1 s + 5 x 0.26 s = 2.4 s just to spawn, so at most one boss per 9.6 s = 250 per second.
  // Both limits are cumulative from t = 0 (the first enemy appears at 1.1 s), so no slack is needed.
  maxScorePerSecond: 1020,
  scoreSlack: 0,
  init,
  update,
  draw,
};

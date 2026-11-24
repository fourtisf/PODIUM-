// Draw-only effects shared by the 2D games: screen shake, scale punch, flashes, floating text, shards, rings,
// speed lines and a vignette, plus a small visual memory per run. Nothing here is called from init() or update()
// and nothing here changes a game state, so it may use Math.random(). Effect time follows the play clock (s.t),
// so effects freeze while the run is paused.
import type { Ctx } from './draw-util';
import { H, W, type BaseState } from './types';

interface Pop { x: number; y: number; age: number; life: number; text: string; c: string; size: number }
interface Bit {
  kind: 'rect' | 'ring' | 'line';
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; w: number; h: number;
  c: string; age: number; life: number; g: number;
}

export interface Juice<M> {
  /** s.t at the previous draw. */
  last: number;
  /** Play time since the previous draw (0 while paused), at most 0.1 s. */
  dt: number;
  shake: number;
  punch: number;
  punchX: number;
  punchY: number;
  flash: number;
  flashC: string;
  pops: Pop[];
  bits: Bit[];
  /** The game's own visual memory. */
  m: M;
}

const MEM = new WeakMap<object, Juice<unknown>>();
let reducedQ: boolean | null = null;

/** The user asked for less motion (no shake, no flashes). False outside a browser. */
export function reducedMotion(): boolean {
  if (reducedQ === null) {
    try {
      reducedQ = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reducedQ = false;
    }
  }
  return reducedQ;
}

/** The visual memory of this run (one per state object), advanced to the state's clock. */
export function juice<M>(s: BaseState, make: () => M): Juice<M> {
  let j = MEM.get(s) as Juice<M> | undefined;
  if (!j) {
    j = { last: s.t, dt: 0, shake: 0, punch: 0, punchX: W / 2, punchY: H / 2, flash: 0, flashC: '#fff', pops: [], bits: [], m: make() };
    MEM.set(s, j as Juice<unknown>);
  }
  j.dt = Math.max(0, Math.min(0.1, s.t - j.last));
  j.last = s.t;
  j.shake = Math.max(0, j.shake - j.dt * 2.2);
  j.punch = Math.max(0, j.punch - j.dt);
  j.flash = Math.max(0, j.flash - j.dt * 3.2);
  return j;
}

export const kickShake = (j: Juice<unknown>, a: number): void => void (j.shake = Math.max(j.shake, a));
export const kickFlash = (j: Juice<unknown>, a: number, c = '#fff'): void => {
  j.flash = Math.max(j.flash, a);
  j.flashC = c;
};
/** A short scale punch (the "hit-stop" feel) around a point. */
export const kickPunch = (j: Juice<unknown>, x: number, y: number, secs = 0.09): void => {
  j.punch = secs;
  j.punchX = x;
  j.punchY = y;
};

/** Floating text ("+3", "PERFECT"). */
export function pop(j: Juice<unknown>, x: number, y: number, text: string, c = '#fff', size = 22, life = 0.8): void {
  j.pops.push({ x, y, age: 0, life, text, c, size });
  if (j.pops.length > 16) j.pops.shift();
}

/** An expanding ring. */
export function ring(j: Juice<unknown>, x: number, y: number, c: string, r: number, life = 0.35, w = 4): void {
  j.bits.push({ kind: 'ring', x, y, vx: 0, vy: 0, rot: 0, vr: 0, w: r, h: w, c, age: 0, life, g: 0 });
}

/** Flying rectangles (debris, chopped pieces, sliced halves). */
export function shard(j: Juice<unknown>, x: number, y: number, w: number, h: number, c: string, vx: number, vy: number, vr = 0, life = 0.8, g = 900): void {
  j.bits.push({ kind: 'rect', x, y, vx, vy, rot: 0, vr, w, h, c, age: 0, life, g });
  if (j.bits.length > 140) j.bits.splice(0, j.bits.length - 140);
}

/** Bright sparks that streak outwards. */
export function sparks(j: Juice<unknown>, x: number, y: number, c: string, n: number, sp = 320): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random() * 0.8);
    j.bits.push({ kind: 'line', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: 0, vr: 0, w: 2.5, h: 0, c, age: 0, life: 0.25 + Math.random() * 0.2, g: 300 });
  }
  if (j.bits.length > 140) j.bits.splice(0, j.bits.length - 140);
}

/** Starts a frame: applies the shake and the scale punch. Pair with endFrame(). */
export function beginFrame(cx: Ctx, j: Juice<unknown>): void {
  cx.save();
  if (reducedMotion()) return;
  if (j.shake > 0) {
    const a = Math.min(1, j.shake) * 14;
    cx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
  }
  if (j.punch > 0) {
    const k = 1 + 0.045 * (j.punch / 0.09);
    cx.translate(j.punchX, j.punchY);
    cx.scale(k, k);
    cx.translate(-j.punchX, -j.punchY);
  }
}

/** Draws the shared bits (rings, shards, sparks); call inside the shaken frame. */
export function drawBits(cx: Ctx, j: Juice<unknown>): void {
  for (let i = j.bits.length - 1; i >= 0; i--) {
    const b = j.bits[i]!;
    b.age += j.dt;
    if (b.age >= b.life) {
      j.bits.splice(i, 1);
      continue;
    }
    const k = b.age / b.life;
    if (b.kind === 'ring') {
      cx.globalAlpha = 1 - k;
      cx.strokeStyle = b.c;
      cx.lineWidth = b.h * (1 - k) + 0.5;
      cx.beginPath();
      cx.arc(b.x, b.y, b.w * (0.3 + 0.7 * Math.sqrt(k)), 0, 7);
      cx.stroke();
      continue;
    }
    b.vy += b.g * j.dt;
    b.x += b.vx * j.dt;
    b.y += b.vy * j.dt;
    b.rot += b.vr * j.dt;
    cx.globalAlpha = Math.min(1, 2 * (1 - k));
    if (b.kind === 'line') {
      cx.strokeStyle = b.c;
      cx.lineWidth = b.w;
      cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(b.x, b.y);
      cx.lineTo(b.x - b.vx * 0.05, b.y - b.vy * 0.05);
      cx.stroke();
    } else {
      cx.save();
      cx.translate(b.x, b.y);
      cx.rotate(b.rot);
      cx.fillStyle = b.c;
      cx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      cx.restore();
    }
  }
  cx.globalAlpha = 1;
}

/** Ends a frame: undoes the shake, then draws the flash and the floating text on top. */
export function endFrame(cx: Ctx, j: Juice<unknown>): void {
  cx.restore();
  if (j.flash > 0 && !reducedMotion()) {
    cx.globalAlpha = Math.min(0.5, j.flash * 0.5);
    cx.fillStyle = j.flashC;
    cx.fillRect(0, 0, W, H);
    cx.globalAlpha = 1;
  }
  cx.textAlign = 'center';
  for (let i = j.pops.length - 1; i >= 0; i--) {
    const p = j.pops[i]!;
    p.age += j.dt;
    if (p.age >= p.life) {
      j.pops.splice(i, 1);
      continue;
    }
    const k = p.age / p.life;
    const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.6);
    cx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    cx.font = `900 ${Math.round(p.size * sc)}px system-ui`;
    cx.lineWidth = 5;
    cx.strokeStyle = '#0a0d24cc';
    cx.lineJoin = 'round';
    const y = p.y - 46 * Math.sqrt(k);
    cx.strokeText(p.text, p.x, y);
    cx.fillStyle = p.c;
    cx.fillText(p.text, p.x, y);
  }
  cx.globalAlpha = 1;
}

/** Red (or any colour) edge darkening, 0..1. */
export function vignette(cx: Ctx, a: number, c = '255,40,80'): void {
  if (a <= 0.01) return;
  const g = cx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
  g.addColorStop(0, `rgba(${c},0)`);
  g.addColorStop(1, `rgba(${c},${Math.min(0.6, a * 0.6)})`);
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, H);
}

/** Motion streaks. `dir` is the way the world moves past the player. */
export function speedLines(cx: Ctx, t: number, amt: number, dir: 'down' | 'left', c = '#ffffff'): void {
  if (amt <= 0.02) return;
  cx.strokeStyle = c;
  cx.lineCap = 'round';
  const n = Math.round(6 + amt * 18);
  for (let i = 0; i < n; i++) {
    const h = ((i * 7919) % 1000) / 1000, h2 = ((i * 104729) % 1000) / 1000;
    const len = 40 + amt * 120 * (0.5 + h2);
    const sp = 900 + 900 * h2;
    cx.globalAlpha = (0.08 + 0.22 * amt) * (0.5 + h);
    cx.lineWidth = 1 + 2 * h2;
    cx.beginPath();
    if (dir === 'down') {
      // Keep the streaks to the sides so they never hide what the player must read.
      const x = h < 0.5 ? h * 2 * 90 : W - (h - 0.5) * 2 * 90;
      const y = ((h2 * H + t * sp) % (H + len)) - len;
      cx.moveTo(x, y);
      cx.lineTo(x, y + len);
    } else {
      const y = h < 0.5 ? 40 + h * 2 * 160 : H - 40 - (h - 0.5) * 2 * 140;
      const x = W - (((h2 * W + t * sp) % (W + len)) - len);
      cx.moveTo(x, y);
      cx.lineTo(x + len, y);
    }
    cx.stroke();
  }
  cx.globalAlpha = 1;
}

/** A soft glow disc (cheap bloom). */
export function glow(cx: Ctx, x: number, y: number, r: number, c: string, a = 0.5): void {
  const g = cx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, c);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.globalAlpha = a;
  cx.fillStyle = g;
  cx.fillRect(x - r, y - r, r * 2, r * 2);
  cx.globalAlpha = 1;
}

/** Big centred callout with a pop-in scale ("COMBO x5"). `age` in seconds since it appeared. */
export function callout(cx: Ctx, text: string, x: number, y: number, age: number, c = '#ffd84a', size = 30): void {
  if (age > 1.1) return;
  const sc = age < 0.12 ? 0.5 + (age / 0.12) * 0.8 : 1.3 - Math.min(0.3, (age - 0.12) * 1.5);
  cx.globalAlpha = age > 0.8 ? (1.1 - age) / 0.3 : 1;
  cx.textAlign = 'center';
  cx.font = `900 ${Math.round(size * sc)}px system-ui`;
  cx.lineJoin = 'round';
  cx.lineWidth = 6;
  cx.strokeStyle = '#0a0d24cc';
  cx.strokeText(text, x, y);
  cx.fillStyle = c;
  cx.fillText(text, x, y);
  cx.globalAlpha = 1;
}

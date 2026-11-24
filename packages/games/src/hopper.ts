// Road Hopper. Port of the prototype's DEF.hopper; the Three.js view is apps/web/src/game3d/hopper.ts.
// World units: columns are 2 wide (x = column * 2) and row r lies at z = -r * 2.
import { ramp } from './pace';
import { rnd } from './rng';
import type { BaseState, GameDef, Press } from './types';

export type HopperRowType = 'grass' | 'road' | 'river';

/** A car (road) or a log (river). */
export interface HopperItem {
  /** Centre x, wrapping within -14..14. */
  x: number;
  len: number;
}

export interface HopperRow {
  /** Row index; the player starts on row 0 and hops towards higher rows. */
  r: number;
  type: HopperRowType;
  /** Travel direction of the row's items: -1 or 1. */
  dir: number;
  speed: number;
  /** Columns (-4..4) blocked by a tree. Trees further out are scenery and belong to the view. */
  trees: number[];
  items: HopperItem[];
}

export interface HopperHop {
  /** From x / row, to x / row. */
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  /** Progress 0..1. */
  t: number;
}

export interface HopperState extends BaseState {
  x: number;
  row: number;
  hop: HopperHop | null;
  /** Camera scroll in world units along the rows. */
  cam: number;
  /** The player has moved; the camera scrolls from then on. */
  go: boolean;
  /** Consecutive river rows generated so far (at most 2 in a row). */
  rivers: number;
  /** Player heading (rotation about y). */
  face: number;
  /** Buffered press, taken when the current hop ends. */
  pend: Press | null;
  /** Live rows, contiguous and ascending: rows[i].r === rows[0].r + i. */
  rows: HopperRow[];
}

/** Seconds one hop takes. */
export const HOP_TIME = 0.13;

function makeRow(s: HopperState, r: number): HopperRow {
  const row: HopperRow = { r, type: 'grass', dir: rnd(s) < 0.5 ? -1 : 1, speed: 0, trees: [], items: [] };
  let t: HopperRowType = 'grass';
  // Version 2: roads and rivers start on row 2 (version 1: row 4), trees on row 2 (version 1: row 3).
  if (r > 1) {
    const x = rnd(s);
    t = x < 0.42 ? 'road' : x < 0.66 && s.rivers < 2 ? 'river' : 'grass';
  }
  s.rivers = t === 'river' ? s.rivers + 1 : 0;
  row.type = t;

  if (t === 'grass') {
    for (let c = -4; c <= 4; c++) {
      if (r > 1 && rnd(s) < 0.2 && row.trees.length < 5) row.trees.push(c);
    }
  } else if (t === 'road') {
    // Version 2: the per-row speed-up opens at row 25 and rejoins the real row at 111 (where it reaches its cap).
    row.speed = 3.4 + rnd(s) * 3 + Math.min(5, ramp(Math.max(0, r), 25, 111) * 0.045);
    const n = 1 + Math.floor(rnd(s) * 3);
    const gap = 28 / n;
    const off = rnd(s) * 28;
    for (let i = 0; i < n; i++) {
      const len = rnd(s) < 0.25 ? 3.6 : 2.3;
      row.items.push({ x: ((off + i * gap) % 28) - 14, len });
    }
  } else {
    row.speed = 1.8 + rnd(s) * 1.8 + Math.min(2, ramp(Math.max(0, r), 25, 100) * 0.02);
    const n = 2 + Math.floor(rnd(s) * 2);
    const gap = 28 / n;
    const off = rnd(s) * 28;
    for (let i = 0; i < n; i++) {
      const len = 3.2 + rnd(s) * 2.4;
      row.items.push({ x: ((off + i * gap) % 28) - 14, len });
    }
  }
  return row;
}

function rowAt(s: HopperState, r: number): HopperRow | undefined {
  const first = s.rows[0];
  return first ? s.rows[r - first.r] : undefined;
}

export const hopper: GameDef<HopperState> = {
  key: 'hopper',
  version: 2,
  gl: true,
  mid: true,
  // score = highest row reached; a hop spans ceil(0.13 * 60) = 8 steps and the next one starts a step later,
  // so at most 60 / 8 = 7.5 rows per second. The slack of 1 absorbs rounding in the accumulated time.
  maxScorePerSecond: 7.5,
  scoreSlack: 1,

  init(seed) {
    const s: HopperState = {
      score: 0, t: 0, seed, fx: [],
      x: 0, row: 0, hop: null, cam: 0, go: false, rivers: 0, face: 0, pend: null, rows: [],
    };
    for (let r = -7; r < 24; r++) s.rows.push(makeRow(s, r));
    return s;
  },

  update(s, input, dt) {
    s.t += dt;
    for (const q of input.presses) s.pend = q;

    if (!s.hop && s.pend) {
      const q = s.pend;
      s.pend = null;
      const dr = q === 'a' ? 1 : 0;
      const dx = q === 'l' ? -2 : q === 'r' ? 2 : 0;
      const tr = s.row + dr;
      const trow = rowAt(s, tr);
      let tx = s.x + dx;
      if (trow && trow.type !== 'river') tx = Math.round(tx / 2) * 2;
      if (Math.abs(tx) <= 8.2 && !(trow && trow.trees.includes(Math.round(tx / 2)))) {
        s.hop = { fx: s.x, fz: s.row, tx, tz: tr, t: 0 };
        s.face = q === 'l' ? Math.PI / 2 : q === 'r' ? -Math.PI / 2 : 0;
        s.go = true;
        s.fx.push({ k: 'beep', f: 520, d: 0.04, w: 'triangle', v: 0.03 });
      }
    }

    // Height above the ground; cars only hit a player below 0.6.
    let y = 0;
    if (s.hop) {
      const h = s.hop;
      h.t += dt / HOP_TIME;
      if (h.t >= 1) {
        s.x = h.tx;
        s.row = h.tz;
        s.hop = null;
        s.score = Math.max(s.score, s.row);
      } else {
        s.x = h.fx + (h.tx - h.fx) * h.t;
        y = Math.sin(Math.PI * h.t) * 0.9;
      }
    }
    const cr = s.hop ? (s.hop.t > 0.5 ? s.hop.tz : s.hop.fz) : s.row;

    for (const row of s.rows) {
      for (const it of row.items) {
        it.x += row.dir * row.speed * dt;
        if (it.x > 14) it.x -= 28;
        if (it.x < -14) it.x += 28;
      }
    }

    const row = rowAt(s, cr);
    if (row) {
      if (row.type === 'road') {
        for (const it of row.items) if (Math.abs(it.x - s.x) < it.len / 2 + 0.42 && y < 0.6) return true;
      } else if (row.type === 'river' && !s.hop) {
        let on = false;
        for (const it of row.items) {
          if (Math.abs(it.x - s.x) < it.len / 2 + 0.25) {
            on = true;
            break;
          }
        }
        if (!on) return true;
        s.x += row.dir * row.speed * dt;
        if (Math.abs(s.x) > 9.4) return true;
      }
    }

    const tz = s.row * 2;
    // Version 2: the camera's drift opens at the speed of score 15 and rejoins the real score at 69 (its cap).
    if (s.go) s.cam += (0.9 + Math.min(2.4, ramp(s.score, 15, 69) * 0.035)) * dt;
    if (tz > s.cam) s.cam += (tz - s.cam) * Math.min(1, dt * 4);
    if (tz < s.cam - 7.5) return true;

    // Keep rows base-8 .. base+23 alive. The camera never moves back, so rows are only added at the far end.
    const base = Math.floor(s.cam / 2);
    for (let r = s.rows[s.rows.length - 1]!.r + 1; r < base + 24; r++) s.rows.push(makeRow(s, r));
    while (s.rows[0]!.r < base - 8) s.rows.shift();
    return false;
  },
};

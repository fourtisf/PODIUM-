// Regenerates packages/shared/src/bots.ts: the Lv 1..10 bot benchmark ladder shown (labelled BOT) on leaderboards.
//
// Every number is a score a bot actually reached by playing the CURRENT rules (gameDef(key) from
// packages/games) through the same fixed 60 Hz update() the server replays. Nothing is invented.
//
//   apps/api/node_modules/.bin/tsx scripts/bot-benchmarks.ts            all games, writes the file
//   apps/api/node_modules/.bin/tsx scripts/bot-benchmarks.ts --dry      prints, writes nothing
//   apps/api/node_modules/.bin/tsx scripts/bot-benchmarks.ts --game snake   one game (prints only)
//
// Method (deterministic: fixed seeds, the bot's own seeded random stream, no Math.random):
//   - each game is played by a bot policy (short rollout search over the real rules, or a hand-written
//     rule for snake, blade and stack) on SEEDS, each run capped at RUN_SECONDS;
//   - Lv 10 = the 90th percentile (nearest rank) of the final scores, so it is a strong but reachable run;
//   - Lv 1  = the median score the bot had after BEGINNER_SECONDS (a few seconds of play), at least 1;
//   - Lv 2..9 are spaced geometrically between them, rounded, and forced strictly increasing.
// Re-run it whenever a game's rules change (a new `version`).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_KEYS, type GameKey } from '../packages/shared/src/index';
import { STEP, gameDef, type Input, type Press } from '../packages/games/src/index';
import { snakeStep } from '../packages/games/src/snake';

const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010];
const RUN_SECONDS = 60;
const BEGINNER_SECONDS = 5;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/shared/src/bots.ts');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Act = { h?: 'l' | 'r'; p?: Press };
const NONE: Act = {};

// The bot's own random stream (mulberry32), reseeded per run, so every run is reproducible.
let rs = 1;
const rand = () => {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const inp = (a: Act, first: boolean): Input => ({ l: a.h === 'l', r: a.h === 'r', ptr: false, px: 0, presses: first && a.p ? [a.p] : [] });

interface Cfg {
  acts: Act[];
  /** Decision interval in frames. */
  k: number;
  /** Look-ahead in frames. */
  hz: number;
  /** Rollouts per candidate action. */
  m: number;
  roll: (s: any) => Act;
  value: (s: any) => number;
  /** Hand-written policy; overrides the search when it returns an action. */
  custom?: (s: any, f: number) => Act | null;
}

const H3: Act[] = [NONE, { h: 'l' }, { h: 'r' }];
const P3: Act[] = [NONE, { p: 'l' }, { p: 'r' }];
const pick = (a: Act[], w: number[]) => {
  let x = rand() * w.reduce((p, c) => p + c, 0);
  for (let i = 0; i < a.length; i++) if ((x -= w[i]!) <= 0) return a[i]!;
  return a[0]!;
};

function sim(def: any, s: any, a: Act, k: number): { dead: boolean; n: number } {
  for (let i = 0; i < k; i++) {
    s.fx.length = 0;
    if (def.update(s, inp(a, i === 0), STEP)) return { dead: true, n: i };
  }
  return { dead: false, n: k };
}

function evalAct(def: any, cfg: Cfg, st: any, a: Act): number {
  let best = -Infinity;
  for (let r = 0; r < cfg.m; r++) {
    const s = structuredClone(st);
    let alive = 0;
    let res = sim(def, s, a, cfg.k);
    alive += res.n;
    while (!res.dead && alive < cfg.hz) {
      res = sim(def, s, cfg.roll(s), cfg.k);
      alive += res.n;
    }
    const v = res.dead ? -1e9 + alive * 1e5 : cfg.value(s);
    if (v > best) best = v;
  }
  return best;
}

function glideTarget(s: any): number {
  const g = s.gates.find((g: any) => g.x + 40 > 140 - 13);
  if (!g) return 320;
  const lim = g.gap / 2 - 24;
  const want = g.gy + (g.st ? g.so : 0);
  return Math.max(g.gy - lim, Math.min(g.gy + lim, want));
}

function snakeMove(s: any): Act {
  if (s.acc + STEP < snakeStep(s)) return NONE;
  const occ = new Set<number>();
  for (let i = 0; i < s.body.length - 1; i++) occ.add(s.body[i][0] * 20 + s.body[i][1]);
  const h = s.body[0];
  const [dx, dy] = s.dir;
  const cands: [Act, number, number][] = [
    [NONE, h[0] + dx, h[1] + dy],
    [{ p: 'l' }, h[0] + dy, h[1] - dx],
    [{ p: 'r' }, h[0] - dy, h[1] + dx],
  ];
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < 20 && y < 20 && !occ.has(x * 20 + y);
  const bfs = (sx: number, sy: number) => {
    const dist = new Map<number, number>();
    const q = [[sx, sy]];
    dist.set(sx * 20 + sy, 0);
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x! + ax!, ny = y! + ay!;
        if (!ok(nx, ny) || dist.has(nx * 20 + ny)) continue;
        dist.set(nx * 20 + ny, dist.get(x! * 20 + y!)! + 1);
        q.push([nx, ny]);
      }
    }
    return dist;
  };
  let best: Act = NONE, bv = -Infinity;
  for (const [a, x, y] of cands) {
    if (!ok(x, y)) continue;
    occ.add(x * 20 + y);
    const d = bfs(x, y);
    occ.delete(x * 20 + y);
    const area = d.size + 1;
    const fd = s.food[0] === x && s.food[1] === y ? 0 : d.get(s.food[0] * 20 + s.food[1]);
    let v = area >= s.body.length + 2 ? 1e6 : area * 1000;
    if (fd !== undefined) v += 1000 - fd * 10;
    if (a === NONE) v += 1;
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}

// Policies first written for the promo video (tuned on the v1 rules); they play the v2 rules unchanged
// apart from snake, which now reads the game's own move timer (snakeStep).
const CFG: Record<GameKey, Cfg> = {
  traffic: { acts: P3, k: 5, hz: 150, m: 8, roll: () => pick(P3, [6, 1, 1]), value: (s) => s.score },
  cube: { acts: H3, k: 4, hz: 100, m: 6, roll: () => pick(H3, [2, 1, 1]), value: (s) => s.score - Math.abs(s.x) * 0.01 },
  duck: {
    acts: H3, k: 4, hz: 90, m: 8, roll: () => pick(H3, [2, 1, 1]),
    value: (s) => {
      const c = s.coins.filter((c: any) => c.y < 520).sort((a: any, b: any) => b.y - a.y)[0];
      return s.score * 100 - (c ? Math.abs(c.x - s.x) * 0.3 : Math.abs(s.x - 240) * 0.05);
    },
  },
  hop: {
    acts: H3, k: 4, hz: 90, m: 6, roll: () => pick(H3, [1, 1, 1]),
    value: (s) => {
      const p = s.plats.filter((p: any) => p.y < s.y - 30 && p.y > s.y - 140).sort((a: any, b: any) => a.y - b.y)[0];
      return s.score * 10 - (p ? Math.abs(p.x - s.x) * 0.05 : 0);
    },
  },
  blaster: {
    acts: H3, k: 4, hz: 70, m: 3, roll: () => pick(H3, [2, 1, 1]),
    value: (s) => s.score + s.lives * 1e5 + (s.en[0] ? -Math.abs(s.en.reduce((b: any, e: any) => (e.y > b.y ? e : b)).x - s.x) * 0.2 : 0),
  },
  breaker: {
    acts: [NONE, { h: 'l' }, { h: 'r' }, { p: 'a' }], k: 3, hz: 90, m: 2, roll: () => pick(H3, [1, 1, 1]),
    value: (s) => {
      let low: any = null;
      for (const b of s.balls) if (!low || b.y > low.y) low = b;
      return s.score + s.lives * 1e5 + s.balls.length * 50 - (low ? Math.abs(low.x - s.px) * 0.3 : 0);
    },
  },
  glide: {
    acts: [NONE, { p: 'a' }], k: 1, hz: 100, m: 6,
    roll: (s) => {
      const t = 8 / 60;
      const pred = s.y + s.vy * t + 450 * t * t;
      return pred > glideTarget(s) + 10 + rand() * 30 ? { p: 'a' } : NONE;
    },
    value: (s) => s.score * 100 - Math.abs(s.y - glideTarget(s)) * 0.3,
    custom: (s, f) => (!s.go ? (f > 20 ? { p: 'a' } : NONE) : null),
  },
  sprint: { acts: [NONE, { p: 'a' }], k: 2, hz: 60, m: 3, roll: () => pick([NONE, { p: 'a' }], [8, 1]), value: (s) => s.score },
  hoop: { acts: [NONE, { p: 'a' }], k: 1, hz: 26, m: 1, roll: () => NONE, value: (s) => s.score * 1000 + s.lives * 10000 },
  hopper: {
    acts: [NONE, { p: 'a' }, { p: 'l' }, { p: 'r' }], k: 10, hz: 90, m: 4,
    roll: () => pick([NONE, { p: 'a' }, { p: 'l' }, { p: 'r' }], [2, 3, 1, 1]),
    value: (s) => s.score * 10 + s.row * 3 - Math.abs(s.x) * 0.2,
  },
  snake: { acts: P3, k: 1, hz: 1, m: 1, roll: () => NONE, value: (s) => s.score, custom: snakeMove },
  blade: {
    acts: P3, k: 1, hz: 1, m: 1, roll: () => NONE, value: (s) => s.score,
    custom: (s) => {
      if (s.cd > 0) return NONE;
      for (const side of [-1, 1]) {
        const e = s.en.filter((e: any) => e.side === side).sort((a: any, b: any) => a.d - b.d)[0];
        if (e && e.d < 62 + e.v * 0.05) return { p: side < 0 ? 'l' : 'r' };
      }
      return NONE;
    },
  },
  stack: {
    acts: [NONE, { p: 'a' }], k: 1, hz: 1, m: 1, roll: () => NONE, value: (s) => s.score,
    custom: (s) => {
      const p = s.blocks[s.blocks.length - 1];
      const c = s.cur;
      // Press when the next step lands closest to aligned (the drop is evaluated after the move).
      const sp = (230 + s.score * 9) / 60;
      const nx = c.x + c.dir * sp;
      return Math.abs(nx - p.x) < Math.min(6.9, sp / 2 + 0.3) ? { p: 'a' } : NONE;
    },
  },
};

interface Run { seed: number; score: number; early: number; seconds: number; dead: boolean }

/** One bot run on the current rules: final score (floored, as submitted) and the score after BEGINNER_SECONDS. */
function play(game: GameKey, seed: number): Run {
  rs = seed * 7919 + 1;
  const def = gameDef(game) as any;
  const cfg = CFG[game];
  const s = def.init(seed);
  const maxF = RUN_SECONDS * 60;
  const earlyF = BEGINNER_SECONDS * 60;
  let early = 0;
  let dead = false;
  let f = 0;
  let cur: Act = NONE;
  while (f < maxF && !dead) {
    const cu = cfg.custom ? cfg.custom(s, f) : null;
    if (cu) cur = cu;
    else if (f % cfg.k === 0) {
      let bv = -Infinity;
      let ba = NONE;
      for (const a of cfg.acts) {
        const v = evalAct(def, cfg, s, a);
        if (v > bv + 1e-9) { bv = v; ba = a; }
      }
      cur = ba;
    }
    const first = cu ? true : f % cfg.k === 0;
    s.fx.length = 0;
    dead = def.update(s, inp(cur, first), STEP);
    f++;
    if (f === earlyF) early = Math.floor(s.score);
  }
  if (f < earlyF) early = Math.floor(s.score);
  return { seed, score: Math.max(0, Math.floor(s.score)), early: Math.max(0, early), seconds: +(f / 60).toFixed(1), dead };
}

const pct = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]!;
};

/** Ten strictly increasing positive integers from lo to hi, spaced geometrically. */
export function ladder(lo: number, hi: number): number[] {
  lo = Math.max(1, Math.round(lo));
  hi = Math.max(lo + 9, Math.round(hi));
  const out: number[] = [];
  for (let i = 0; i < 10; i++) out.push(Math.round(lo * Math.pow(hi / lo, i / 9)));
  for (let i = 1; i < 10; i++) out[i] = Math.max(out[i]!, out[i - 1]! + 1);
  for (let i = 8; i >= 0; i--) out[i] = Math.min(out[i]!, out[i + 1]! - 1);
  return out;
}

interface Result { game: GameKey; version: number; runs: Run[]; lv1: number; lv10: number; steps: number[] }

function bench(game: GameKey): Result {
  const runs = SEEDS.map((seed) => play(game, seed));
  const lv10 = pct(runs.map((r) => r.score), 0.9);
  const lv1 = Math.max(1, pct(runs.map((r) => r.early), 0.5));
  const steps = ladder(Math.min(lv1, lv10), lv10);
  return { game, version: gameDef(game).version, runs, lv1: steps[0]!, lv10: steps[9]!, steps };
}

function child(game: GameKey): Promise<Result> {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--child', game], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', (code) => (code === 0 ? res(JSON.parse(out) as Result) : rej(new Error(`${game} exited ${code}`))));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--child') {
    process.stdout.write(JSON.stringify(bench(args[1] as GameKey)));
    return;
  }
  const only = args.includes('--game') ? (args[args.indexOf('--game') + 1] as GameKey) : null;
  const games = only ? [only] : [...GAME_KEYS];
  const results = await Promise.all(games.map(child));
  for (const r of results) {
    console.log(`${r.game} v${r.version}: lv1 ${r.lv1}, lv10 ${r.lv10}  [${r.steps.join(', ')}]`);
    console.log('   runs ' + r.runs.map((x) => `${x.seed}:${x.score}${x.dead ? `@${x.seconds}s` : ''}/${x.early}`).join(' '));
  }
  if (only || args.includes('--dry')) return;
  const by = new Map(results.map((r) => [r.game, r]));
  const lines = GAME_KEYS.map((k) => {
    const r = by.get(k)!;
    const finals = r.runs.map((x) => x.score).join(' ');
    return `  /** rules v${r.version}. Bot final scores (${RUN_SECONDS} s cap): ${finals}. */\n  ${k}: [${r.steps.join(', ')}],`;
  });
  const src = `// GENERATED by scripts/bot-benchmarks.ts. Do not edit by hand; re-run the script when a game's rules change.
//
// DISPLAY-ONLY bot benchmarks: the ten labelled bot rows (Lv 1..Lv 10, see botCast.ts) the web app adds under thin boards so
// players have something to beat. They are not players: they are never stored, never ranked, never take a place
// number, and never affect prizes, payouts, missions, XP, notifications, duels or any API response.
//
// How the numbers were produced: a bot played each game's CURRENT rules (gameDef(key), the same deterministic
// 60 Hz update() the server replays) on seeds ${SEEDS.join(', ')}, each run capped at ${RUN_SECONDS} s.
// Lv 10 is the 90th percentile of those final scores; Lv 1 is the median score after ${BEGINNER_SECONDS} s of play;
// Lv 2..9 are spaced geometrically between them. Index 0 is Lv 1, index 9 is Lv 10 (strictly increasing).
// Who plays each level (names and avatars) lives in botCast.ts, which is written by hand.
import type { GameKey } from './games';

export const BOT_LADDER: Record<GameKey, number[]> = {
${lines.join('\n')}
};
`;
  writeFileSync(OUT, src);
  console.log('wrote ' + OUT);
}

void main();

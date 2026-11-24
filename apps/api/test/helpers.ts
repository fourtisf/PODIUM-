// Test helpers: a real app on the test database, cookie- and CSRF-aware clients, a movable clock,
// and game-agnostic run plans (scores always come from calling replay(), never from assumptions).
import { randomUUID } from 'node:crypto';
import { Ev, gameDef, replay, rnd } from '@podium/games';
import { GAME_KEYS, type AuthResponse, type FinishRunResponse, type GameKey, type MeResponse, type RunMode, type StartRunResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from '../src/app';
import type { Ctx } from '../src/ctx';

export const GAME: GameKey = 'duck';
export const OTHER_GAME: GameKey = 'glide';
const TABLES = ['AdminAction', 'Activity', 'Notification', 'ReferralReward', 'SeasonClaim', 'MissionProgress', 'Challenge', 'Run', 'Duel', 'Score', 'Period', 'Idempotency', 'Ledger', 'Item', 'Counter', 'User'];

export interface TestApp {
  app: FastifyInstance;
  ctx: Ctx;
  /** Moves the app's clock forward. */
  advance(ms: number): void;
  /** Jumps the app's clock to a moment (it keeps ticking from there). */
  setNow(d: Date | string): void;
  now(): Date;
  /** Seed given to the next runs. */
  seed: number;
  close(): Promise<void>;
}

export async function makeApp(opts: AppOptions = {}): Promise<TestApp> {
  let offset = 0;
  const t = { seed: 12345 } as TestApp;
  const app = await buildApp({ logger: false, clock: { now: () => new Date(Date.now() + offset) }, seed: () => t.seed, ...opts });
  await app.ready();
  t.app = app;
  t.ctx = app.ctx;
  t.advance = (ms) => void (offset += ms);
  t.setNow = (d) => void (offset = +new Date(d) - Date.now());
  t.now = () => app.ctx.clock.now();
  t.close = () => app.close();
  return t;
}

/** Empties the test database and Redis db 1. Called at the start of every test file. */
export async function reset(t: TestApp): Promise<void> {
  await t.ctx.db.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((n) => `"${n}"`).join(', ')} CASCADE`);
  await t.ctx.redis.flushdb();
}

export async function freshApp(opts: AppOptions = {}): Promise<TestApp> {
  const t = await makeApp(opts);
  await reset(t);
  return t;
}

export interface Res<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

interface ReqOpts {
  /** Idempotency-Key to send; a fresh one is generated when omitted. Pass null to send none. */
  idem?: string | null;
  csrf?: string | null;
  headers?: Record<string, string>;
}

/** One browser: keeps cookies and the CSRF token between requests. */
export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  device = 'dev-' + randomUUID();
  id = '';
  name = '';
  email = '';

  constructor(readonly t: TestApp) {}

  private async send<T>(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, o: ReqOpts = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { 'x-device': this.device, ...o.headers };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET') {
      const csrf = o.csrf === undefined ? this.csrf : o.csrf;
      if (csrf) headers['x-csrf-token'] = csrf;
      const idem = o.idem === undefined ? randomUUID() : o.idem;
      if (idem) headers['idempotency-key'] = idem;
    }
    const res = await this.t.app.inject({ method, url: '/api' + url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    for (const c of res.cookies) {
      if (c.value) this.cookies.set(c.name, c.value);
      else this.cookies.delete(c.name);
    }
    let parsed: unknown = null;
    try {
      parsed = res.json();
    } catch {
      parsed = res.body;
    }
    const b = parsed as { csrf?: unknown } | null;
    if (res.statusCode < 300 && b && typeof b === 'object' && typeof b.csrf === 'string') this.csrf = b.csrf;
    return { status: res.statusCode, body: parsed as T, headers: res.headers };
  }

  get<T = unknown>(url: string, o?: ReqOpts): Promise<Res<T>> {
    return this.send<T>('GET', url, undefined, o);
  }
  post<T = unknown>(url: string, body?: unknown, o?: ReqOpts): Promise<Res<T>> {
    return this.send<T>('POST', url, body ?? {}, o);
  }
  patch<T = unknown>(url: string, body?: unknown, o?: ReqOpts): Promise<Res<T>> {
    return this.send<T>('PATCH', url, body ?? {}, o);
  }

  /** Gets an (anonymous) session and its CSRF token. */
  async start(): Promise<this> {
    await this.get('/auth/csrf');
    return this;
  }

  async me(): Promise<MeResponse> {
    const r = await this.get<MeResponse>('/me');
    if (r.status !== 200) throw new Error('GET /me → ' + r.status);
    return r.body;
  }

  async balance(): Promise<number> {
    return (await this.me()).user.balance;
  }
}

/** A visitor with an anonymous session (CSRF token but no account). */
export const visitor = (t: TestApp): Promise<Client> => new Client(t).start();

export async function guest(t: TestApp): Promise<Client> {
  const c = await visitor(t);
  const r = await c.post<AuthResponse>('/auth/guest');
  if (r.status !== 200) throw new Error('guest → ' + JSON.stringify(r.body));
  c.id = r.body.userId;
  c.name = r.body.name;
  return c;
}

let counter = 0;
export interface SignUpOpts {
  name?: string;
  ref?: string;
  email?: string;
  adult?: boolean;
  /** Start from this client (e.g. a guest) instead of a new browser. */
  from?: Client;
  /** Skip Phase 2 reward gating by marking the account as having validated ranked runs. */
  unlocked?: boolean;
}

/** Signs up through the real email-code flow and returns the signed-in client. */
export async function signUp(t: TestApp, o: SignUpOpts = {}): Promise<Client> {
  const c = o.from ?? (await visitor(t));
  c.email = o.email ?? `p${++counter}-${randomUUID().slice(0, 8)}@example.com`;
  const req = await c.post('/auth/email/request', { email: c.email });
  if (req.status !== 200) throw new Error('email request → ' + JSON.stringify(req.body));
  const code = t.ctx.devCodes.get(c.email);
  if (!code) throw new Error('no code was issued');
  const r = await c.post<AuthResponse>('/auth/email/verify', { email: c.email, code, adult: o.adult ?? true, name: o.name, ref: o.ref });
  if (r.status !== 200) throw new Error('email verify → ' + JSON.stringify(r.body));
  c.id = r.body.userId;
  c.name = r.body.name;
  if (o.unlocked) await t.ctx.db.user.update({ where: { id: c.id }, data: { validatedRanked: 99 } });
  return c;
}

// ---------------------------------------------------------------- run plans
export interface Plan {
  log: number[];
  frames: number;
  score: number;
  dead: boolean;
}

const CAP = 60 * 60 * 8; // give a run eight minutes of game time to end

/** Random-looking but reproducible human-ish input: presses, holds and pointer drags. */
function scripted(variant: number, frames: number): number[] {
  const r = { seed: variant * 7919 + 13 };
  const log: number[] = [];
  let l = false, rt = false, ptr = false;
  for (let f = 0; f < frames; f++) {
    if (rnd(r) < 0.05) log.push(f, [Ev.PRESS_L, Ev.PRESS_R, Ev.PRESS_A][Math.floor(rnd(r) * 3)]!, 0);
    if (rnd(r) < 0.03) { l = !l; log.push(f, l ? Ev.L_DOWN : Ev.L_UP, 0); }
    if (rnd(r) < 0.03) { rt = !rt; log.push(f, rt ? Ev.R_DOWN : Ev.R_UP, 0); }
    if (rnd(r) < 0.01) { ptr = !ptr; log.push(f, ptr ? Ev.PTR_ON : Ev.PTR_OFF, Math.floor(rnd(r) * 481)); }
    else if (ptr && rnd(r) < 0.3) log.push(f, Ev.PTR_MOVE, Math.floor(rnd(r) * 481));
  }
  return log;
}

const planCache = new Map<string, Plan>();
/** Plays `game` on `seed` with input variant `variant` (0 = no input) until the run ends. */
export function plan(game: GameKey, seed: number, variant = 0): Plan {
  const key = `${game}:${seed}:${variant}`;
  let p = planCache.get(key);
  if (!p) {
    const full = variant === 0 ? [] : scripted(variant, 60 * 60 * 2);
    const r = replay(gameDef(game), seed, full, CAP);
    const log: number[] = [];
    for (let i = 0; i < full.length && full[i]! < r.frames; i += 3) log.push(full[i]!, full[i + 1]!, full[i + 2]!);
    p = { log, frames: r.frames, score: r.score, dead: r.dead };
    planCache.set(key, p);
  }
  return p;
}

/** `n` runs of a game on one seed that all end in death with different scores, lowest first. */
export function distinctPlans(game: GameKey, seed: number, n: number): Plan[] {
  const out: Plan[] = [];
  for (let v = 0; v < 80 && out.length < n; v++) {
    const p = plan(game, seed, v);
    if (p.dead && p.score > 0 && !out.some((o) => o.score === p.score)) out.push(p);
  }
  if (out.length < n) throw new Error(`could not find ${n} distinct scores for ${game}`);
  return out.sort((a, b) => a.score - b.score);
}

/** A game and a run of it that ends in death after more than `minFrames` frames (whichever game offers one). */
export function longPlan(seed: number, minFrames: number): { game: GameKey; plan: Plan } {
  for (const game of [GAME, OTHER_GAME, ...GAME_KEYS]) {
    for (let v = 0; v < 25; v++) {
      const p = plan(game, seed, v);
      if (p.dead && p.frames > minFrames && p.frames < 60 * 60 * 3) return { game, plan: p };
    }
  }
  throw new Error(`no game has a run longer than ${minFrames} frames`);
}

export interface PlayOpts {
  plan?: Plan;
  variant?: number;
  duelId?: string;
  challengeCode?: string;
  /** Score the browser claims; defaults to the true one. */
  clientScore?: number;
  /** Wall-clock time to let pass before finishing; defaults to the run's length plus a little. */
  waitMs?: number;
  idem?: string;
}

export interface Played {
  start: Res<StartRunResponse>;
  finish: Res<FinishRunResponse>;
  plan: Plan;
}

/** Starts a run, lets the clock pass for as long as it lasts, and finishes it. */
export async function playRun(c: Client, game: GameKey, mode: RunMode, o: PlayOpts = {}): Promise<Played> {
  const start = await c.post<StartRunResponse>('/runs', { game, mode, duelId: o.duelId, challengeCode: o.challengeCode });
  if (start.status !== 200) throw new Error(`start ${mode} run → ${start.status} ${JSON.stringify(start.body)}`);
  const p = o.plan ?? plan(game, start.body.seed, o.variant ?? 0);
  c.t.advance(o.waitMs ?? (p.frames / 60) * 1000 + 500);
  const finish = await c.post<FinishRunResponse>(`/runs/${start.body.runId}/finish`, { score: o.clientScore ?? p.score, frames: p.frames, inputLog: p.log }, { idem: o.idem });
  return { start, finish, plan: p };
}

export const errCode = (r: Res): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
export const ledgerCount = (t: TestApp, userId: string, reason?: string): Promise<number> => t.ctx.db.ledger.count({ where: { userId, ...(reason ? { reason } : {}) } });

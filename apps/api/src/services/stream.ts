// Phase 2 live input stream. The browser sends its inputs while the run is played; the server keeps
// them (Redis list), checks the run keeps up with real time, and ends it when it stops or stalls.
// One API instance owns all streams (see deploy/ecosystem.config.js), so timing state is in memory
// and mirrored to Redis only so a reconnect after a restart can continue.
import { MAX_LOG_EVENTS, validateLog } from '@podium/games';
import { ANTI_ABUSE, type StreamChunk, type StreamReply } from '@podium/shared';
import { z } from 'zod';
import { LIMITS } from '../config';
import type { Ctx } from '../ctx';
import { hmac, safeEqual } from '../util';

const MS_PER_FRAME = 1000 / 60;

interface State {
  runId: string;
  /** Wall-clock ms when the run was created and when the first / latest message arrived. */
  createdAt: number;
  firstAt: number;
  lastAt: number;
  to: number;
  lastEventFrame: number;
  events: number;
}

export interface StreamSnapshot {
  to: number;
  events: number[];
}

const chunkSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  ev: z.array(z.number().int()).max(30_000),
  paused: z.boolean().optional(),
});

/** How a run that the stream decided to end is settled; provided by runs.ts (avoids an import cycle). */
export type EndRun = (runId: string, how: { reject: string } | { ended: string }, snap: StreamSnapshot) => Promise<void>;

export class StreamService {
  private states = new Map<string, State>();
  private timer: NodeJS.Timeout | null = null;
  endRun: EndRun = async () => {};

  constructor(private ctx: Ctx) {}

  private evKey = (id: string): string => `run:${id}:ev`;
  private stKey = (id: string): string => `run:${id}:st`;

  /** Short-lived token for the socket, so the stream does not depend on cookies. */
  token(runId: string, createdAt: Date): string {
    const exp = +createdAt + ANTI_ABUSE.sessionSeconds * 1000;
    return `${exp}.${hmac(this.ctx.cfg.sessionSecret, `stream:${runId}:${exp}`)}`;
  }

  checkToken(runId: string, token: string): boolean {
    const [exp, mac] = token.split('.');
    if (!exp || !mac || !/^\d+$/.test(exp)) return false;
    if (Number(exp) < +this.ctx.clock.now()) return false;
    return safeEqual(mac, hmac(this.ctx.cfg.sessionSecret, `stream:${runId}:${exp}`));
  }

  private async load(runId: string): Promise<State | null> {
    const mem = this.states.get(runId);
    if (mem) return mem;
    const run = await this.ctx.db.run.findUnique({ where: { id: runId }, select: { status: true, createdAt: true } });
    if (!run || run.status !== 'open') return null;
    const now = +this.ctx.clock.now();
    const saved = await this.ctx.redis.hgetall(this.stKey(runId));
    const st: State = saved.to !== undefined
      ? { runId, createdAt: +run.createdAt, firstAt: Number(saved.firstAt), lastAt: now, to: Number(saved.to), lastEventFrame: Number(saved.lastEventFrame), events: Number(saved.events) }
      : { runId, createdAt: +run.createdAt, firstAt: now, lastAt: now, to: 0, lastEventFrame: 0, events: 0 };
    this.states.set(runId, st);
    return st;
  }

  /** Handles one message of the stream. Never throws for bad input: a bad stream ends the run. */
  async onMessage(runId: string, raw: unknown): Promise<StreamReply> {
    const st = await this.load(runId);
    if (!st) return { ended: true, reason: 'run is not open' };
    const parsed = chunkSchema.safeParse(raw);
    if (!parsed.success) return this.end(st, { reject: 'malformed stream message' });
    const c: StreamChunk = parsed.data;
    const now = +this.ctx.clock.now();
    // Chunks are contiguous and frames never go backwards. Events of a chunk lie in [from, to].
    if (c.from !== st.to || c.to < c.from) return this.end(st, { reject: 'stream chunks are not contiguous' });
    const bad = validateLog(c.ev, c.to + 1);
    if (bad) return this.end(st, { reject: 'stream: ' + bad });
    if (c.ev.length && c.ev[0]! < Math.max(c.from, st.lastEventFrame)) return this.end(st, { reject: 'stream frames go backwards' });
    if (st.events + c.ev.length / 3 > MAX_LOG_EVENTS) return this.end(st, { reject: 'stream is too long' });
    if (c.to > ANTI_ABUSE.maxRunSeconds * 60) return this.end(st, { reject: 'run is too long' });
    // Speed-hack check: the game cannot have simulated more frames than real time allows.
    if (c.to * MS_PER_FRAME > now - st.createdAt + LIMITS.clockSlackMs) return this.end(st, { reject: 'stream is ahead of real time' });

    st.to = c.to;
    st.lastAt = now;
    if (c.ev.length) {
      st.lastEventFrame = c.ev[c.ev.length - 3]!;
      st.events += c.ev.length / 3;
    }
    const pipe = this.ctx.redis.multi();
    if (c.ev.length) pipe.rpush(this.evKey(runId), JSON.stringify(c.ev));
    pipe.hset(this.stKey(runId), { to: st.to, firstAt: st.firstAt, lastEventFrame: st.lastEventFrame, events: st.events });
    pipe.expire(this.evKey(runId), ANTI_ABUSE.sessionSeconds).expire(this.stKey(runId), ANTI_ABUSE.sessionSeconds);
    await pipe.exec();

    if (this.behindMs(st, now) > ANTI_ABUSE.maxBehindMs) return this.end(st, { ended: 'run fell too far behind real time' });
    return { ok: true, to: st.to };
  }

  /** Time the run has spent paused or lagging since its first message. */
  private behindMs(st: State, now: number): number {
    return now - st.firstAt - st.to * MS_PER_FRAME;
  }

  private async end(st: State, how: { reject: string } | { ended: string }): Promise<StreamReply> {
    this.states.delete(st.runId);
    const snap = (await this.snapshot(st.runId)) ?? { to: st.to, events: [] };
    await this.endRun(st.runId, how, snap);
    return { ended: true, reason: 'reject' in how ? how.reject : how.ended };
  }

  /** Ends runs whose stream stopped or fell behind. Called every second by the server, and directly by tests. */
  async tick(): Promise<number> {
    const now = +this.ctx.clock.now();
    let ended = 0;
    for (const st of [...this.states.values()]) {
      const why = now - st.lastAt > ANTI_ABUSE.streamTimeoutMs ? 'input stream stopped' : this.behindMs(st, now) > ANTI_ABUSE.maxBehindMs ? 'run fell too far behind real time' : null;
      if (!why) continue;
      try {
        await this.end(st, { ended: why });
        ended++;
      } catch (e) {
        this.ctx.log.error(e, 'ending a stalled run failed');
      }
    }
    return ended;
  }

  /** Everything received so far for a run, or null when nothing was streamed. */
  async snapshot(runId: string): Promise<StreamSnapshot | null> {
    const [st, chunks] = await Promise.all([this.ctx.redis.hgetall(this.stKey(runId)), this.ctx.redis.lrange(this.evKey(runId), 0, -1)]);
    if (st.to === undefined) return null;
    const events: number[] = [];
    for (const c of chunks) for (const n of JSON.parse(c) as number[]) events.push(n);
    return { to: Number(st.to), events };
  }

  /** Forget a run once it is settled. */
  async clear(runId: string): Promise<void> {
    this.states.delete(runId);
    await this.ctx.redis.del(this.evKey(runId), this.stKey(runId));
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// Phase 2 live input stream, with REQUIRE_STREAM on. Most cases drive the stream service directly;
// the last one goes through a real WebSocket on a random port.
import { gameDef, replay } from '@podium/games';
import { ANTI_ABUSE, ECONOMY, type FinishRunResponse, type StartRunResponse, type StreamReply } from '@podium/shared';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import WebSocket from 'ws';
import { Client, GAME, distinctPlans, errCode, freshApp, longPlan, plan, signUp, type Plan, type TestApp } from './helpers';

let t: TestApp;
let withInput: Plan;
beforeAll(async () => {
  t = await freshApp({ config: { requireStream: true } });
  withInput = distinctPlans(GAME, t.seed, 3).find((p) => p.log.length > 0)!;
});
afterAll(() => t.close());

const STEP = Math.round((ANTI_ABUSE.streamEveryMs / 1000) * 60); // frames between chunks
const start = async (c: Client, mode = 'ranked'): Promise<StartRunResponse> => (await c.post<StartRunResponse>('/runs', { game: GAME, mode })).body;
const finish = (c: Client, runId: string, p: Plan, log = p.log) => c.post<FinishRunResponse>(`/runs/${runId}/finish`, { score: p.score, frames: p.frames, inputLog: log });
const reason = (r: { body: unknown }): string => (r.body as { error: { message: string } }).error.message;

/** Streams a plan in real time up to `upTo` frames, the way the browser does. */
async function streamTo(runId: string, p: Plan, upTo = p.frames, log = p.log): Promise<StreamReply> {
  let from = 0;
  let i = 0;
  let last: StreamReply = { ok: true, to: 0 };
  while (from < upTo) {
    const to = Math.min(upTo, from + STEP);
    t.advance(((to - from) / 60) * 1000);
    const ev: number[] = [];
    while (i < log.length && log[i]! < to) ev.push(log[i++]!, log[i++]!, log[i++]!);
    last = await t.ctx.stream.onMessage(runId, { from, to, ev });
    if ('ended' in last) return last;
    from = to;
  }
  return last;
}

test('a ranked finish without a live stream is rejected; practice does not need one', async () => {
  const c = await signUp(t);
  const p = plan(GAME, t.seed);
  const s = await start(c);
  t.advance((p.frames / 60) * 1000 + 500);
  const r = await finish(c, s.runId, p);
  expect([r.status, errCode(r)]).toEqual([422, 'run_rejected']);
  expect(reason(r)).toMatch(/no live input stream/);
  const pr = await start(c, 'practice');
  t.advance((p.frames / 60) * 1000 + 500);
  expect((await finish(c, pr.runId, p)).status).toBe(200);
});

test('a streamed run is accepted when the submitted log matches what was streamed', async () => {
  const c = await signUp(t, { name: 'Streamer' });
  for (const p of [plan(GAME, t.seed), withInput]) {
    const s = await start(c);
    expect(await streamTo(s.runId, p)).toEqual({ ok: true, to: p.frames });
    t.advance(300);
    const r = await finish(c, s.runId, p);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'finished', score: p.score });
    const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.runId } });
    expect(run.streamedTo).toBe(p.frames);
    expect(await t.ctx.redis.exists(`run:${s.runId}:ev`, `run:${s.runId}:st`)).toBe(0); // cleaned up
  }
});

test('the last chunks may be missing, but not more than three stream intervals', async () => {
  const c = await signUp(t);
  const allowed = STEP * 3;
  const { game, plan: p } = longPlan(t.seed, allowed + STEP);
  const start = async (cl: Client): Promise<StartRunResponse> => (await cl.post<StartRunResponse>('/runs', { game, mode: 'ranked' })).body;
  const ok = await start(c);
  await streamTo(ok.runId, p, p.frames - allowed);
  t.advance((allowed / 60) * 1000 + 300);
  expect((await finish(c, ok.runId, p)).status).toBe(200);
  const short = await start(c);
  await streamTo(short.runId, p, p.frames - allowed - STEP);
  t.advance(((allowed + STEP) / 60) * 1000 + 300);
  const r = await finish(c, short.runId, p);
  expect(r.status).toBe(422);
  expect(reason(r)).toMatch(/does not cover/);
});

test('a submitted log that differs from the stream is rejected', async () => {
  const c = await signUp(t);
  const p = withInput;
  // Streamed without input, then finished with input: events were slipped in afterwards.
  const s1 = await start(c);
  await streamTo(s1.runId, p, p.frames, []);
  t.advance(300);
  const r1 = await finish(c, s1.runId, p);
  expect(r1.status).toBe(422);
  expect(reason(r1)).toMatch(/does not match/);
  // Streamed with input, finished with a different log.
  const s2 = await start(c);
  await streamTo(s2.runId, p);
  t.advance(300);
  const changed = [...p.log];
  changed[1] = changed[1] === 4 ? 5 : 4;
  const r2 = await finish(c, s2.runId, p, changed);
  expect(r2.status).toBe(422);
  expect(reason(r2)).toMatch(/does not match|replay/);
  expect(await c.balance()).toBe(ECONOMY.startBalance - 2 * ECONOMY.rankedEntry);
});

test('a stream that runs ahead of real time (speed hack) rejects the run', async () => {
  const c = await signUp(t);
  const s = await start(c);
  t.advance(1000);
  const res = await t.ctx.stream.onMessage(s.runId, { from: 0, to: 600, ev: [] });
  expect(res).toEqual({ ended: true, reason: 'stream is ahead of real time' });
  expect(await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.runId } })).toMatchObject({ status: 'rejected', reason: 'stream is ahead of real time' });
  expect(await t.ctx.stream.onMessage(s.runId, { from: 0, to: 10, ev: [] })).toEqual({ ended: true, reason: 'run is not open' });
});

test('chunks must be contiguous and well formed', async () => {
  const c = await signUp(t);
  const s = await start(c);
  t.advance(5000);
  expect(await t.ctx.stream.onMessage(s.runId, { from: 0, to: 120, ev: [] })).toEqual({ ok: true, to: 120 });
  expect(await t.ctx.stream.onMessage(s.runId, { from: 200, to: 240, ev: [] })).toMatchObject({ ended: true });
  expect((await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.runId } })).status).toBe('rejected');
  const s2 = await start(c);
  t.advance(5000);
  expect(await t.ctx.stream.onMessage(s2.runId, { from: 0, to: 60, ev: [10, 99, 0] })).toMatchObject({ ended: true });
  const s3 = await start(c);
  t.advance(5000);
  expect(await t.ctx.stream.onMessage(s3.runId, 'garbage')).toMatchObject({ ended: true, reason: 'malformed stream message' });
});

test('a stream that stops is ended by the server and scored from the inputs received so far', async () => {
  const c = await signUp(t, { name: 'Dropper' });
  const p = plan(GAME, t.seed);
  const s = await start(c);
  const upTo = STEP * 3;
  await streamTo(s.runId, p, upTo);
  expect(await t.ctx.stream.tick()).toBe(0);
  t.advance(ANTI_ABUSE.streamTimeoutMs + 500);
  expect(await t.ctx.stream.tick()).toBe(1);
  expect(await t.ctx.stream.tick()).toBe(0);
  const partial = replay(gameDef(GAME), t.seed, [], upTo);
  const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.runId } });
  expect(run).toMatchObject({ status: 'finished', score: partial.score, frames: upTo, streamedTo: upTo, clientScore: null, reason: 'input stream stopped' });
  if (partial.score > 0) expect(await t.ctx.db.score.count({ where: { userId: c.id, score: partial.score } })).toBe(1);
  // The browser's own finish arrives late: it gets the server's result, and nothing is settled twice.
  const late = await finish(c, s.runId, p);
  expect(late.status).toBe(200);
  expect(late.body).toMatchObject({ runId: s.runId, status: 'finished', score: partial.score });
  expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: c.id } })).rankedDone).toBe(1);
});

test('pausing eats the behind-real-time budget; over it the run is ended', async () => {
  const c = await signUp(t);
  const p = plan(GAME, t.seed);
  const s = await start(c);
  await streamTo(s.runId, p, STEP);
  // Paused: heartbeats keep the stream alive.
  let res: StreamReply = { ok: true, to: STEP };
  let beats = 0;
  while (!('ended' in res) && beats < 40) {
    t.advance(ANTI_ABUSE.streamEveryMs);
    res = await t.ctx.stream.onMessage(s.runId, { from: STEP, to: STEP, ev: [], paused: true });
    beats++;
  }
  expect(res).toEqual({ ended: true, reason: 'run fell too far behind real time' });
  expect(beats).toBe(Math.floor(ANTI_ABUSE.maxBehindMs / ANTI_ABUSE.streamEveryMs) + 1);
  expect((await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.runId } })).status).toBe('finished');
});

test('WS /api/runs/:id/stream: token-authenticated, no cookie needed', async () => {
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (t.app.server.address() as AddressInfo).port;
  const c = await signUp(t);
  const s = await start(c);
  t.advance(3000);
  const url = (token: string): string => `ws://127.0.0.1:${port}/api/runs/${s.runId}/stream?token=${encodeURIComponent(token)}`;
  const talk = (token: string, msgs: unknown[]): Promise<StreamReply[]> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url(token));
      const got: StreamReply[] = [];
      ws.on('open', () => msgs.forEach((m) => ws.send(JSON.stringify(m))));
      ws.on('message', (d) => {
        got.push(JSON.parse(String(d)) as StreamReply);
        if (got.length >= Math.max(1, msgs.length) || 'ended' in got[got.length - 1]!) ws.close();
      });
      ws.on('close', () => resolve(got));
      ws.on('error', reject);
    });
  expect(await talk('123.bad', [])).toEqual([{ ended: true, reason: 'bad stream token' }]);
  const good = await talk(s.streamToken, [{ from: 0, to: 60, ev: [] }, { from: 60, to: 120, ev: [] }]);
  expect(good).toEqual([{ ok: true, to: 60 }, { ok: true, to: 120 }]);
  expect(await t.ctx.stream.snapshot(s.runId)).toEqual({ to: 120, events: [] });
  // A token only opens its own run.
  const other = await start(c);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/runs/${other.runId}/stream?token=${encodeURIComponent(s.streamToken)}`);
  const first = await new Promise<StreamReply>((resolve, reject) => {
    ws.on('message', (d) => resolve(JSON.parse(String(d)) as StreamReply));
    ws.on('error', reject);
  });
  expect(first).toEqual({ ended: true, reason: 'bad stream token' });
  ws.close();
});

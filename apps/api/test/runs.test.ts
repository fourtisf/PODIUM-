import { gameDef, maxPlausibleScore, replay, Ev } from '@podium/games';
import { duckV1 } from '@podium/games/src/duck.v1';
import { GAME_VERSIONS, currentVersion, versionDef } from '../src/services/gameVersions';
import { ANTI_ABUSE, ECONOMY, XP, levelOf, type FinishRunResponse, type StartRunResponse } from '@podium/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { judge, runDropsBox, settleRun } from '../src/services/runs';
import { GAME, errCode, freshApp, guest, ledgerCount, plan, playRun, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

const pool = async (): Promise<number> => (await t.ctx.db.period.findFirst({ where: { kind: 'weekly', game: GAME } }))?.pool ?? 0;
const SECRET = 'test-secret-test-secret-test-secret';

describe('POST /runs', () => {
  test('no session → 401; a guest can only play practice', async () => {
    const v = await visitor(t);
    expect((await v.post('/runs', { game: GAME, mode: 'practice' })).status).toBe(401);
    const g = await guest(t);
    for (const mode of ['ranked', 'cup', 'duel', 'challenge']) {
      const r = await g.post('/runs', { game: GAME, mode });
      expect([mode, r.status, errCode(r)]).toEqual([mode, 403, 'guest_not_allowed']);
    }
    expect((await g.post('/runs', { game: GAME, mode: 'practice' })).status).toBe(200);
  });

  test('practice: the first runs are free, then it costs the practice entry and is not pooled', async () => {
    const g = await guest(t);
    const before = await pool();
    for (let i = 0; i < ECONOMY.freePracticeRuns; i++) {
      const r = await g.post<StartRunResponse>('/runs', { game: GAME, mode: 'practice' });
      expect(r.body).toMatchObject({ entry: 0, balance: ECONOMY.startBalance, freePractice: ECONOMY.freePracticeRuns - 1 - i });
    }
    const paid = await g.post<StartRunResponse>('/runs', { game: GAME, mode: 'practice' });
    expect(paid.body).toMatchObject({ entry: ECONOMY.practiceEntry, balance: ECONOMY.startBalance - ECONOMY.practiceEntry, freePractice: 0 });
    expect(await pool()).toBe(before);
    expect((await g.me()).user.stats).toMatchObject({ plays: ECONOMY.freePracticeRuns + 1, spent: ECONOMY.practiceEntry });
  });

  test('ranked: charges the entry into the weekly pool; a replayed start does not charge twice', async () => {
    const c = await signUp(t);
    const before = await pool();
    const first = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' }, { idem: 'start-key-00001' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ entry: ECONOMY.rankedEntry, balance: ECONOMY.startBalance - ECONOMY.rankedEntry, seed: t.seed, gameVersion: gameDef(GAME).version });
    expect(first.body.streamToken).toBeTruthy();
    const replayed = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' }, { idem: 'start-key-00001' });
    expect(replayed.body).toEqual(first.body);
    expect(await pool()).toBe(before + ECONOMY.rankedEntry);
    expect(await c.balance()).toBe(ECONOMY.startBalance - ECONOMY.rankedEntry);
    expect(await ledgerCount(t, c.id, 'entry')).toBe(1);
    expect(await t.ctx.db.run.count({ where: { userId: c.id } })).toBe(1);
    const row = await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: c.id } });
    expect(row).toMatchObject({ amount: -ECONOMY.rankedEntry, idemKey: `entry:${first.body.runId}` });
  });

  test('validation: Idempotency-Key, game, mode, balance', async () => {
    const c = await signUp(t);
    expect((await c.post('/runs', { game: GAME, mode: 'ranked' }, { idem: null })).status).toBe(400);
    expect((await c.post('/runs', { game: GAME, mode: 'ranked' }, { idem: 'short' })).status).toBe(400);
    expect((await c.post('/runs', { game: 'tetris', mode: 'ranked' })).status).toBe(400);
    expect((await c.post('/runs', { game: GAME, mode: 'turbo' })).status).toBe(400);
    expect((await c.post('/runs', { game: GAME, mode: 'duel' })).status).toBe(400);
    await t.ctx.db.user.update({ where: { id: c.id }, data: { balance: ECONOMY.rankedEntry - 1 } });
    const before = await pool();
    const poor = await c.post('/runs', { game: GAME, mode: 'ranked' });
    expect([poor.status, errCode(poor)]).toEqual([402, 'not_enough_chips']);
    expect(await pool()).toBe(before);
    expect(await c.balance()).toBe(ECONOMY.rankedEntry - 1);
    expect(await t.ctx.db.run.count({ where: { userId: c.id } })).toBe(0);
  });
});

describe('POST /runs/:id/finish', () => {
  test('the server replays the log and uses its own score; an inflated client score is ignored', async () => {
    const c = await signUp(t, { name: 'Replayer' });
    const p = plan(GAME, t.seed);
    expect(p.dead).toBe(true);
    const seconds = p.frames / 60;
    const ceiling = maxPlausibleScore(GAME, seconds);
    const claimed = ceiling > p.score ? ceiling : Math.max(0, p.score - 1); // a lie the sanity check lets through
    expect(claimed).not.toBe(p.score);
    const { start, finish } = await playRun(c, GAME, 'ranked', { clientScore: claimed });
    expect(finish.status).toBe(200);
    const expectXp = (seconds >= XP.minRunSeconds ? XP.rankedRun : 0) + (p.score > 0 ? XP.personalBest : 0);
    const box = runDropsBox(SECRET, start.body.runId);
    expect(finish.body).toMatchObject({
      runId: start.body.runId, status: 'finished', game: GAME, mode: 'ranked', score: p.score, place: p.score > 0 ? 1 : 0, newBest: p.score > 0,
      xpGained: expectXp, boxDropped: box, rewardsHeld: false,
      user: { balance: ECONOMY.startBalance - ECONOMY.rankedEntry, xp: expectXp, level: levelOf(expectXp), boxes: ECONOMY.startBoxes + (box ? 1 : 0) },
    });
    expect(finish.body.top5[0]).toEqual({ place: 1, name: 'Replayer', score: p.score, me: true });
    const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: start.body.runId } });
    expect(run).toMatchObject({ status: 'finished', score: p.score, clientScore: claimed, frames: p.frames, rewardsHeld: false });
    expect(JSON.parse(Buffer.from(run.inputLog!).toString())).toEqual(p.log);
    expect(run.durationMs).toBeGreaterThanOrEqual(Math.floor(seconds * 1000));
    const user = await t.ctx.db.user.findUniqueOrThrow({ where: { id: c.id } });
    expect(user).toMatchObject({ rankedDone: 1, validatedRanked: 1 });
  });

  test('a replayed finish settles the run once (same key and a different key)', async () => {
    const c = await signUp(t);
    const p = plan(GAME, t.seed, 1);
    const { start, finish } = await playRun(c, GAME, 'ranked', { plan: p, idem: 'finish-key-0001' });
    expect(finish.status).toBe(200);
    const url = `/runs/${start.body.runId}/finish`;
    const body = { score: p.score, frames: p.frames, inputLog: p.log };
    const same = await c.post<FinishRunResponse>(url, body, { idem: 'finish-key-0001' });
    const other = await c.post<FinishRunResponse>(url, { ...body, score: 0 }, { idem: 'finish-key-0002' });
    for (const r of [same, other]) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual(finish.body);
      expect(r.headers['idempotent-replay']).toBe('true');
    }
    const user = await t.ctx.db.user.findUniqueOrThrow({ where: { id: c.id } });
    expect(user.xp).toBe(finish.body.xpGained);
    expect(user.rankedDone).toBe(1);
    expect(await t.ctx.db.score.count({ where: { userId: c.id } })).toBe(p.score > 0 ? 1 : 0);
    // Two finishes racing each other also settle once.
    const s2 = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' });
    t.advance((p.frames / 60) * 1000 + 500);
    const race = await Promise.all([1, 2, 3].map(() => c.post<FinishRunResponse>(`/runs/${s2.body.runId}/finish`, body)));
    expect(race.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(race[1]!.body).toEqual(race[0]!.body);
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: c.id } })).rankedDone).toBe(2);
  });

  test('an impossible score is rejected; the entry is not refunded', async () => {
    const c = await signUp(t);
    const p = plan(GAME, t.seed);
    const { start, finish } = await playRun(c, GAME, 'ranked', { clientScore: maxPlausibleScore(GAME, p.frames / 60) + 1000 });
    expect(finish.status).toBe(422);
    expect(errCode(finish)).toBe('run_rejected');
    const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: start.body.runId } });
    expect(run).toMatchObject({ status: 'rejected', score: null });
    expect(run.reason).toMatch(/impossible/);
    expect(run.inputLog).not.toBeNull(); // the log is kept
    expect(await c.balance()).toBe(ECONOMY.startBalance - ECONOMY.rankedEntry);
    expect(await t.ctx.db.score.count({ where: { userId: c.id } })).toBe(0);
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: c.id } })).xp).toBe(0);
    // Finishing it again returns the same rejection.
    const again = await c.post(`/runs/${start.body.runId}/finish`, { score: p.score, frames: p.frames, inputLog: p.log });
    expect(again.status).toBe(422);
    expect(again.body).toEqual(finish.body);
  });

  test('a finish that arrives sooner than the run could have lasted is rejected', async () => {
    const c = await signUp(t);
    const p = plan(GAME, t.seed);
    expect((p.frames / 60) * 1000).toBeGreaterThan(2500);
    const { finish } = await playRun(c, GAME, 'ranked', { waitMs: 0 });
    expect(finish.status).toBe(422);
    expect((finish.body as unknown as { error: { message: string } }).error.message).toMatch(/sooner/);
  });

  test('a finish after the session window is rejected', async () => {
    const c = await signUp(t);
    const { finish } = await playRun(c, GAME, 'ranked', { waitMs: ANTI_ABUSE.sessionSeconds * 1000 + 1000 });
    expect(finish.status).toBe(422);
    expect((finish.body as unknown as { error: { message: string } }).error.message).toMatch(/expired/);
  });

  test('ranked runs must end by dying at the last frame; practice takes the replayed score where the player left', async () => {
    const c = await signUp(t);
    const p = plan(GAME, t.seed);
    const early = { ...p, frames: p.frames - 30 };
    const partial = replay(gameDef(GAME), t.seed, [], early.frames);
    expect(partial.dead).toBe(false);
    const ranked = await playRun(c, GAME, 'ranked', { plan: early, clientScore: partial.score });
    expect(ranked.finish.status).toBe(422);
    const late = await playRun(c, GAME, 'ranked', { plan: { ...p, frames: p.frames + 30 } });
    expect(late.finish.status).toBe(422);
    const practice = await playRun(c, GAME, 'practice', { plan: early, clientScore: partial.score });
    expect(practice.finish.status).toBe(200);
    expect(practice.finish.body).toMatchObject({ status: 'finished', score: partial.score, place: 0, newBest: false, xpGained: 0, boxDropped: false, badges: ['not_recorded'], top5: [] });
    expect(await t.ctx.db.score.count({ where: { userId: c.id } })).toBe(0);
  });

  test('malformed logs, unknown runs and other players\' runs', async () => {
    const c = await signUp(t);
    const d = await signUp(t);
    const s = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'practice' });
    t.advance(20_000);
    expect((await d.post(`/runs/${s.body.runId}/finish`, { score: 0, frames: 60, inputLog: [] })).status).toBe(404);
    expect((await c.post('/runs/nope/finish', { score: 0, frames: 60, inputLog: [] })).status).toBe(404);
    expect((await c.post(`/runs/${s.body.runId}/finish`, { score: 0, frames: 60, inputLog: [] }, { idem: null })).status).toBe(400);
    expect((await c.post(`/runs/${s.body.runId}/finish`, { score: -1, frames: 60, inputLog: [] })).status).toBe(400);
    expect((await (await visitor(t)).post(`/runs/${s.body.runId}/finish`, { score: 0, frames: 60, inputLog: [] })).status).toBe(401);
    const bad = await c.post(`/runs/${s.body.runId}/finish`, { score: 0, frames: 60, inputLog: [10, Ev.PRESS_A, 0, 5, Ev.PRESS_A] });
    expect(bad.status).toBe(422);
    expect((await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.body.runId } })).status).toBe('rejected');
  });

  test('more presses per second than the limit is rejected', async () => {
    const c = await signUp(t);
    const log: number[] = [];
    for (let i = 0; i <= ANTI_ABUSE.maxPressesPerSecond; i++) log.push(60 + i * 2, Ev.PRESS_A, 0);
    const frames = 300;
    const r = replay(gameDef(GAME), t.seed, log, frames);
    const res = await playRun(c, GAME, 'practice', { plan: { log, frames, score: r.score, dead: r.dead } });
    expect(res.finish.status).toBe(422);
    expect((res.finish.body as unknown as { error: { message: string } }).error.message).toMatch(/too many inputs/);
  });

  test('machine-regular input is flagged: nothing is recorded, rewards are held, the replay is kept', async () => {
    const c = await signUp(t);
    const log: number[] = [];
    for (let i = 0; i < ANTI_ABUSE.regularityMinPresses + 10; i++) log.push(6 + i * 12, Ev.PRESS_R, 0);
    const frames = 6 + (ANTI_ABUSE.regularityMinPresses + 10) * 12;
    const r = replay(gameDef(GAME), t.seed, log, frames);
    const res = await playRun(c, GAME, 'practice', { plan: { log, frames, score: r.score, dead: r.dead } });
    expect(res.finish.status).toBe(200);
    expect(res.finish.body).toMatchObject({ status: 'flagged', rewardsHeld: true, xpGained: 0, boxDropped: false, badges: ['held'], missionsCompleted: [] });
    const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: res.start.body.runId } });
    expect(run).toMatchObject({ status: 'flagged', rewardsHeld: true, score: r.score });
    expect(run.reason).toMatch(/regular/);
    expect(JSON.parse(Buffer.from(run.inputLog!).toString())).toEqual(log);
    expect(await t.ctx.db.missionProgress.count({ where: { userId: c.id } })).toBe(0);
    expect(await t.ctx.db.run.count({ where: { status: 'flagged' } })).toBeGreaterThan(0); // queryable for review
  });

  test('a flagged ranked run stays off the board and the entry is not refunded', async () => {
    const c = await signUp(t);
    const s = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' });
    const p = plan(GAME, t.seed);
    t.advance((p.frames / 60) * 1000 + 500);
    const input = { frames: p.frames, log: p.log, clientScore: p.score };
    const out = await t.ctx.db.$transaction((tx) => settleRun(t.ctx, tx, s.body.runId, input, { kind: 'flag', score: p.score, seconds: p.frames / 60, reason: 'machine-regular input timing' }, 0));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'flagged', rewardsHeld: true, place: 0 });
    expect(await t.ctx.db.score.count({ where: { userId: c.id } })).toBe(0);
    const u = await t.ctx.db.user.findUniqueOrThrow({ where: { id: c.id } });
    expect(u).toMatchObject({ xp: 0, rankedDone: 0, validatedRanked: 0, balance: ECONOMY.startBalance - ECONOMY.rankedEntry, boxes: ECONOMY.startBoxes });
    // The client's own finish now gets that stored answer.
    const fin = await c.post<FinishRunResponse>(`/runs/${s.body.runId}/finish`, { score: p.score, frames: p.frames, inputLog: p.log });
    expect(fin.body).toEqual(out.body);
  });

  test('a run started on version 1 is finished and replayed on version 1, a new run on the current version', async () => {
    expect(GAME).toBe('duck');
    expect(currentVersion(GAME)).toBe(2);
    expect(versionDef(GAME, 1)).toBe(duckV1);
    expect(versionDef(GAME, 2)).toBe(gameDef(GAME));
    expect(Object.keys(GAME_VERSIONS[GAME]).map(Number)).toEqual([1, 2]);
    const c = await signUp(t);
    const fresh = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'practice' });
    expect(fresh.body.gameVersion).toBe(2);
    expect((await t.ctx.db.run.findUniqueOrThrow({ where: { id: fresh.body.runId } })).gameVersion).toBe(2);
    // A run in flight from before the deploy carries version 1.
    const s = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'practice' });
    await t.ctx.db.run.update({ where: { id: s.body.runId }, data: { gameVersion: 1 } });
    const v1 = replay(duckV1, s.body.seed, [], 60 * 120);
    const v2 = replay(gameDef(GAME), s.body.seed, [], 60 * 120);
    expect(v1.dead).toBe(true);
    // The same idle run plays out differently on the two versions (version 2 starts with logs on the river).
    expect(v2.frames).not.toBe(v1.frames);
    t.advance(130_000);
    const fin = await c.post<FinishRunResponse>(`/runs/${s.body.runId}/finish`, { score: v1.score, frames: v1.frames, inputLog: [] });
    expect(fin.status).toBe(200);
    expect(fin.body.score).toBe(v1.score);
  });

  test('a run replays on the version it was played on; an unknown version is rejected', async () => {
    const c = await signUp(t);
    const s = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'practice' });
    await t.ctx.db.run.update({ where: { id: s.body.runId }, data: { gameVersion: 999 } });
    t.advance(30_000);
    const fin = await c.post(`/runs/${s.body.runId}/finish`, { score: 0, frames: 60, inputLog: [] });
    expect(fin.status).toBe(422);
    expect((fin.body as { error: { message: string } }).error.message).toMatch(/version/);
  });
});

describe('judge()', () => {
  test('is a pure function of the run and its input', async () => {
    const c = await signUp(t);
    const s = await c.post<StartRunResponse>('/runs', { game: GAME, mode: 'ranked' });
    const run = await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.body.runId } });
    const p = plan(GAME, t.seed);
    const later = new Date(+run.createdAt + (p.frames / 60) * 1000 + 100);
    const v = judge(run, { frames: p.frames, log: p.log, clientScore: 0 }, later, null, false);
    expect(v).toMatchObject({ kind: 'ok', score: p.score });
    expect(judge(run, { frames: p.frames, log: p.log, clientScore: 0 }, later, null, true)).toMatchObject({ kind: 'reject', reason: 'no live input stream' });
    expect(judge(run, { frames: ANTI_ABUSE.maxRunSeconds * 60 + 1, log: [], clientScore: 0 }, later, null, false).kind).toBe('reject');
    expect(judge(run, { frames: 0, log: [], clientScore: 0 }, later, null, false).kind).toBe('reject');
  });
});

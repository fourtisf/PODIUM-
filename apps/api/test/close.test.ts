import { ECONOMY, XP, cupGame, dayNum, periodEnd, splitPool, weeklyStart, type GameKey, type NotificationsResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { closeDuePeriods } from '../src/services/close';
import { cleanup } from '../src/services/jobs';
import { cupPeriod, weeklyPeriod } from '../src/services/periods';
import { Client, GAME, OTHER_GAME, distinctPlans, freshApp, ledgerCount, playRun, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

const WEEK = 7 * 86_400_000;
const fees = async (now: Date): Promise<number> => (await t.ctx.db.counter.findUnique({ where: { key: 'fees:' + dayNum(now) } }))?.value ?? 0;

test('the weekly close pays 50/30/20 of the pool minus the fee, exactly once', async () => {
  const [low, mid, high] = distinctPlans(GAME, t.seed, 3);
  const a = await signUp(t, { name: 'First' });
  const b = await signUp(t, { name: 'Second' });
  const c = await signUp(t, { name: 'Third' });
  const d = await signUp(t, { name: 'Fourth' });
  await playRun(c, GAME, 'ranked', { plan: low });
  await playRun(a, GAME, 'ranked', { plan: high });
  await playRun(b, GAME, 'ranked', { plan: mid });
  t.advance(1000);
  await playRun(d, GAME, 'ranked', { plan: low }); // ties Third later → fourth place, unpaid
  // One more entry each from the top three so the pool is a known 700.
  for (const p of [a, b, c]) expect((await p.post('/runs', { game: GAME, mode: 'ranked' })).status).toBe(200);
  const period = await weeklyPeriod(t.ctx.db, GAME, t.now());
  expect(period.pool).toBe(700);
  expect(splitPool(700, ECONOMY.weeklySplit, 3)).toEqual({ fee: 42, payouts: [329, 197, 132] });
  const spent = { a: 200, b: 200, c: 200, d: 100 };
  const xpBefore = Object.fromEntries(await Promise.all([a, b, c, d].map(async (p) => [p.name, (await p.me()).user.xp] as const)));

  // Not due yet: nothing happens.
  expect(await closeDuePeriods(t.ctx, t.now())).toEqual({ ran: true, closed: [] });
  expect((await t.ctx.db.period.findUniqueOrThrow({ where: { id: period.id } })).closed).toBe(false);

  const at = new Date(+period.endAt + 60_000);
  const feesBefore = await fees(at);
  const report = await closeDuePeriods(t.ctx, at);
  expect(report.ran).toBe(true);
  const mine = report.closed.find((r) => r.periodId === period.id)!;
  expect(mine).toMatchObject({ kind: 'weekly', game: GAME, pool: 700, fee: 42 });
  expect(mine.payouts).toEqual([{ userId: a.id, place: 1, amount: 329 }, { userId: b.id, place: 2, amount: 197 }, { userId: c.id, place: 3, amount: 132 }]);
  expect(42 + 329 + 197 + 132).toBe(700);

  const check = async (): Promise<void> => {
    expect(await a.balance()).toBe(ECONOMY.startBalance - spent.a + 329);
    expect(await b.balance()).toBe(ECONOMY.startBalance - spent.b + 197);
    expect(await c.balance()).toBe(ECONOMY.startBalance - spent.c + 132);
    expect(await d.balance()).toBe(ECONOMY.startBalance - spent.d);
    for (const p of [a, b, c]) expect((await p.me()).user.xp).toBe(xpBefore[p.name]! + XP.weeklyTopThree);
    expect((await d.me()).user.xp).toBe(xpBefore[d.name]);
    const scores = await t.ctx.db.score.findMany({ where: { periodId: period.id }, orderBy: { place: 'asc' } });
    expect(scores.map((s) => [s.userId, s.place, s.payout])).toEqual([[a.id, 1, 329], [b.id, 2, 197], [c.id, 3, 132], [d.id, 4, 0]]);
    expect(await t.ctx.db.period.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({ closed: true, fee: 42, pool: 700 });
    expect(await t.ctx.db.ledger.count({ where: { reason: 'payout', ref: period.id } })).toBe(3);
    expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { reason: 'payout', userId: a.id } })).idemKey).toBe(`payout:${period.id}:${a.id}`);
    expect(await fees(at)).toBe(feesBefore + 42);
    expect(await t.ctx.db.notification.count({ where: { kind: 'payout', userId: { in: [a.id, b.id, c.id, d.id] } } })).toBe(3);
  };
  await check();
  const note = (await a.get<NotificationsResponse>('/notifications')).body.items.find((n) => n.kind === 'payout')!;
  expect(note.body).toContain('place <b>1</b>');
  expect(note.body).toContain('<b>329 tChips</b>');

  // Running it again changes nothing.
  const second = await closeDuePeriods(t.ctx, at);
  expect(second).toEqual({ ran: true, closed: [] });
  await check();
  expect(await closeDuePeriods(t.ctx, new Date(+at + 3_600_000))).toEqual({ ran: true, closed: [] });
  await check();

  // The next period exists, is open, and starts empty.
  const next = await t.ctx.db.period.findUniqueOrThrow({ where: { kind_game_startAt: { kind: 'weekly', game: GAME, startAt: period.endAt } } });
  expect(next).toMatchObject({ pool: 0, closed: false, endAt: periodEnd(period.endAt) });
  expect(await t.ctx.db.score.count({ where: { periodId: next.id } })).toBe(0);
});

test('with fewer players than paid places the unclaimed shares go to fees', async () => {
  t.setNow(new Date(+weeklyStart(t.now()) + 2 * WEEK + 3_600_000));
  const [p] = distinctPlans(OTHER_GAME, t.seed, 1);
  const solo = await signUp(t, { name: 'Solo' });
  await playRun(solo, OTHER_GAME, 'ranked', { plan: p });
  await solo.post('/runs', { game: OTHER_GAME, mode: 'ranked' });
  await solo.post('/runs', { game: OTHER_GAME, mode: 'ranked' });
  const period = await weeklyPeriod(t.ctx.db, OTHER_GAME, t.now());
  expect(period.pool).toBe(300);
  const at = new Date(+period.endAt + 1000);
  const feesBefore = await fees(at);
  const report = await closeDuePeriods(t.ctx, at);
  const mine = report.closed.find((r) => r.periodId === period.id)!;
  const first = splitPool(300, ECONOMY.weeklySplit, 1).payouts[0]!;
  expect(first).toBe(141);
  expect(mine.payouts).toEqual([{ userId: solo.id, place: 1, amount: 141 }]);
  expect(mine.fee).toBe(300 - 141);
  expect(await solo.balance()).toBe(ECONOMY.startBalance - 300 + 141);
  expect(await fees(at)).toBe(feesBefore + report.closed.reduce((s, r) => s + r.fee, 0));
  expect((await t.ctx.db.period.findUniqueOrThrow({ where: { id: period.id } })).fee).toBe(159);
});

test('the Cup closes with its own split and has no top-three XP; empty periods just close', async () => {
  const now = t.now();
  const cup = await cupPeriod(t.ctx.db, now);
  expect(cup.game).toBe(cupGame(now));
  const players = await Promise.all(['CupOne', 'CupTwo'].map((name) => signUp(t, { name })));
  // Put real rows on the Cup board directly: the Cup game may be any of five games.
  await t.ctx.db.period.update({ where: { id: cup.id }, data: { pool: 1000 } });
  await t.ctx.db.score.createMany({ data: players.map((p, i) => ({ periodId: cup.id, userId: p.id, score: 100 - i, runId: 'r' + i, setAt: now })) });
  const report = await closeDuePeriods(t.ctx, new Date(+cup.endAt + 1000));
  const mine = report.closed.find((r) => r.periodId === cup.id)!;
  const { payouts } = splitPool(1000, ECONOMY.cupSplit, 2);
  expect(payouts).toEqual([376, 235]);
  expect(mine.payouts.map((x) => x.amount)).toEqual(payouts);
  expect(mine.fee).toBe(1000 - 376 - 235);
  expect(await players[0]!.balance()).toBe(ECONOMY.startBalance + 376);
  expect((await players[0]!.me()).user.xp).toBe(0);
  expect((await players[0]!.me()).user.stats.won).toBe(376);
  const empties = report.closed.filter((r) => r.pool === 0);
  expect(empties.every((r) => r.fee === 0 && r.payouts.length === 0)).toBe(true);
  expect(await t.ctx.db.period.count({ where: { closed: false, endAt: { lte: new Date(+cup.endAt + 1000) } } })).toBe(0);
  // The next Cup exists with the next game in the rotation.
  const next = await t.ctx.db.period.findFirstOrThrow({ where: { kind: 'cup', startAt: cup.endAt } });
  expect(next.game).toBe(cupGame(cup.endAt) as GameKey);
});

test('a second instance holding the lock makes the job stand down', async () => {
  await t.ctx.redis.set('lock:close', 'someone-else', 'PX', 10_000);
  expect(await closeDuePeriods(t.ctx, new Date(+t.now() + 10 * WEEK))).toEqual({ ran: false, closed: [] });
  expect(await t.ctx.redis.get('lock:close')).toBe('someone-else'); // not released by us
  await t.ctx.redis.del('lock:close');
  expect((await closeDuePeriods(t.ctx, t.now())).ran).toBe(true);
  expect(await t.ctx.redis.get('lock:close')).toBeNull();
});

test('a board read after the close shows the new, empty week', async () => {
  t.setNow(new Date(+weeklyStart(t.now()) + WEEK + 5000));
  await closeDuePeriods(t.ctx, t.now());
  const r = await new Client(t).get<{ rows: unknown[]; pool: number }>('/leaderboard/' + GAME);
  expect(r.body).toMatchObject({ rows: [], pool: 0 });
});

test('housekeeping: stale open runs are given up, old idempotency records dropped', async () => {
  await cleanup(t.ctx, new Date(+t.now() + 30 * 86_400_000)); // clear what the earlier tests left behind
  const c = await signUp(t);
  const s = await c.post<{ runId: string }>('/runs', { game: GAME, mode: 'practice' });
  const keys = await t.ctx.db.idempotency.count();
  expect(keys).toBeGreaterThan(0);
  expect(await cleanup(t.ctx, t.now())).toEqual({ idempotency: 0, runs: 0 });
  const later = new Date(+t.now() + 30 * 86_400_000);
  const res = await cleanup(t.ctx, later);
  expect(res.runs).toBe(1);
  expect(res.idempotency).toBe(keys);
  expect(await t.ctx.db.run.findUniqueOrThrow({ where: { id: s.body.runId } })).toMatchObject({ status: 'rejected', reason: 'abandoned' });
  expect(await ledgerCount(t, c.id)).toBe(0);
});

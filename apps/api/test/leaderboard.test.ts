import { ECONOMY, gameMeta, periodEnd, projectedPrize, weeklyStart, fmt, type LeaderboardResponse, type NotificationsResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client, GAME, OTHER_GAME, distinctPlans, freshApp, playRun, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

const board = async (c: Client, game = GAME): Promise<LeaderboardResponse> => (await c.get<LeaderboardResponse>('/leaderboard/' + game)).body;

test('an empty board: public, no rows, pool zero, marked beta', async () => {
  const anon = new Client(t);
  const r = await anon.get<LeaderboardResponse>('/leaderboard/' + GAME);
  expect(r.status).toBe(200);
  const start = weeklyStart(t.now());
  expect(r.body).toEqual({
    game: GAME, period: { startAt: start.toISOString(), endAt: periodEnd(start).toISOString() }, pool: 0, fee: 0,
    payouts: ECONOMY.weeklySplit.map(() => 0), rows: [], me: null, beta: true,
  });
  expect((await anon.get('/leaderboard/tetris')).status).toBe(404);
});

test('two accounts see the same board; best score counts; a tie goes to the earlier score', async () => {
  const [low, mid, high] = distinctPlans(GAME, t.seed, 3);
  const a = await signUp(t, { name: 'Anna' });
  const b = await signUp(t, { name: 'Ben' });
  const c = await signUp(t, { name: 'Cleo' });
  expect((await playRun(a, GAME, 'ranked', { plan: mid })).finish.body).toMatchObject({ score: mid!.score, place: 1, newBest: true });
  t.advance(1000);
  // Ben ties Anna later: Anna keeps the higher place.
  expect((await playRun(b, GAME, 'ranked', { plan: mid })).finish.body).toMatchObject({ place: 2, newBest: true });
  t.advance(1000);
  expect((await playRun(c, GAME, 'ranked', { plan: low })).finish.body).toMatchObject({ place: 3 });

  const pool = 3 * ECONOMY.rankedEntry;
  const seenByA = await board(a);
  const seenByB = await board(b);
  const seenByAnon = await board(new Client(t));
  expect(seenByA.rows).toEqual(seenByB.rows);
  expect(seenByAnon.rows).toEqual(seenByA.rows);
  expect(seenByA.rows.map((r) => [r.place, r.name, r.score])).toEqual([[1, 'Anna', mid!.score], [2, 'Ben', mid!.score], [3, 'Cleo', low!.score]]);
  expect(seenByA.rows.map((r) => r.prize)).toEqual([1, 2, 3].map((p) => projectedPrize(pool, ECONOMY.weeklySplit, p)));
  expect(seenByA).toMatchObject({ pool, fee: Math.round(pool * ECONOMY.fee), payouts: [1, 2, 3].map((p) => projectedPrize(pool, ECONOMY.weeklySplit, p)), beta: true });
  expect(seenByA.me).toEqual({ place: 1, score: mid!.score });
  expect(seenByB.me).toEqual({ place: 2, score: mid!.score });
  expect(seenByAnon.me).toBeNull();

  // A worse run later does not replace the best, nor move its time.
  const worse = await playRun(a, GAME, 'ranked', { plan: low });
  expect(worse.finish.body).toMatchObject({ score: low!.score, newBest: false, place: 1 });
  expect((await board(a)).rows.map((r) => r.name)).toEqual(['Anna', 'Ben', 'Cleo']);

  // Cleo overtakes both: they are told, with their new places.
  const top = await playRun(c, GAME, 'ranked', { plan: high });
  expect(top.finish.body).toMatchObject({ place: 1, newBest: true, prizeIfHeld: projectedPrize(5 * ECONOMY.rankedEntry, ECONOMY.weeklySplit, 1) });
  expect(top.finish.body.top5.map((r) => [r.place, r.name, r.me])).toEqual([[1, 'Cleo', true], [2, 'Anna', false], [3, 'Ben', false]]);
  const after = await board(b);
  expect(after.rows.map((r) => r.name)).toEqual(['Cleo', 'Anna', 'Ben']);
  expect(after.me).toEqual({ place: 3, score: mid!.score });
  const game = gameMeta(GAME).name;
  const notesA = (await a.get<NotificationsResponse>('/notifications')).body.items.filter((n) => n.kind === 'passed');
  const notesB = (await b.get<NotificationsResponse>('/notifications')).body.items.filter((n) => n.kind === 'passed');
  expect(notesA.map((n) => n.body)).toEqual([`<b>Cleo</b> passed you in <b>${game}</b> with ${fmt(high!.score)}. You are now place 2.`]);
  expect(notesB.map((n) => n.body)).toEqual([`<b>Cleo</b> passed you in <b>${game}</b> with ${fmt(high!.score)}. You are now place 3.`]);

  // Postgres is the truth: with the Redis sorted set gone, or wrong, the board is rebuilt the same.
  const keys = await t.ctx.redis.keys('lb:*');
  expect(keys.length).toBeGreaterThan(0);
  await t.ctx.redis.del(...keys);
  expect((await board(a)).rows).toEqual(after.rows);
  await t.ctx.redis.zadd(keys[0]!, 1, 'ghost-user');
  expect((await board(a)).rows).toEqual(after.rows);
  expect((await board(a)).rows).toEqual(after.rows);
});

test('boards are per game', async () => {
  const d = await signUp(t, { name: 'Dora' });
  const [p] = distinctPlans(OTHER_GAME, t.seed, 1);
  await playRun(d, OTHER_GAME, 'ranked', { plan: p });
  expect((await board(d, OTHER_GAME)).rows.map((r) => r.name)).toEqual(['Dora']);
  expect((await board(d, GAME)).me).toBeNull();
});

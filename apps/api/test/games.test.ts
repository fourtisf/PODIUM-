import { ECONOMY, FEATURED_ORDER, GAME_KEYS, periodEnd, weeklyStart, type GamesResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { GAME, freshApp, playRun, signUp, visitor, type TestApp, Client } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('GET /games is public: thirteen games, empty boards, pools at zero, no generated players', async () => {
  const anon = new Client(t);
  const r = await anon.get<GamesResponse>('/games');
  expect(r.status).toBe(200);
  expect(r.body.games.map((g) => g.key)).toEqual(GAME_KEYS);
  for (const g of r.body.games) {
    expect(g).toMatchObject({ pool: 0, top3: [], myBest: null, plays: 0 });
    expect(g.endsAt).toBe(periodEnd(weeklyStart(t.now())).toISOString());
  }
  expect(r.body.hero).toBe(FEATURED_ORDER[0]);
  expect(await t.ctx.db.user.count()).toBe(0);
  // Asking again gives the same answer (and serves from the cache).
  expect((await anon.get<GamesResponse>('/games')).body.games).toEqual(r.body.games);
});

test('pools, top three, my best and the hero follow real play', async () => {
  const a = await signUp(t, { name: 'Alpha' });
  const b = await signUp(t, { name: 'Bravo' });
  const run = await playRun(a, GAME, 'ranked');
  expect(run.finish.status).toBe(200);
  const forA = (await a.get<GamesResponse>('/games')).body;
  const card = forA.games.find((g) => g.key === GAME)!;
  expect(card.pool).toBe(ECONOMY.rankedEntry);
  expect(card.plays).toBe(1);
  expect(card.top3).toEqual([{ name: 'Alpha', avatar: 0, frame: 'none', score: run.plan.score }]);
  expect(card.myBest).toBe(run.plan.score);
  const forB = (await b.get<GamesResponse>('/games')).body;
  expect(forB.games.find((g) => g.key === GAME)!.myBest).toBeNull();
  expect(forB.games.find((g) => g.key === GAME)!.top3).toEqual(card.top3);
  expect((await (await visitor(t)).get<GamesResponse>('/games')).body.games.find((g) => g.key === GAME)!.pool).toBe(ECONOMY.rankedEntry);

  // The hero is the featured game with the largest pool; ties go to FEATURED_ORDER.
  const second = FEATURED_ORDER[1]!;
  expect((await b.post('/runs', { game: second, mode: 'ranked' })).status).toBe(200);
  expect((await b.get<GamesResponse>('/games')).body.hero).toBe(second);
  expect((await b.post('/runs', { game: FEATURED_ORDER[0]!, mode: 'ranked' })).status).toBe(200);
  expect((await b.get<GamesResponse>('/games')).body.hero).toBe(FEATURED_ORDER[0]);
});

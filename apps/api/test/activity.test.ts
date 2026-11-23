import { fmt, gameMeta, type ActivityResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { LIMITS } from '../src/config';
import { addActivity } from '../src/services/notifications';
import { Client, GAME, distinctPlans, freshApp, playRun, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('the ticker is public, starts empty and shows real events only', async () => {
  const anon = new Client(t);
  expect((await anon.get<ActivityResponse>('/activity')).body).toEqual({ items: [] });
  const [low, high] = distinctPlans(GAME, t.seed, 2);
  const c = await signUp(t, { name: 'Ticker' });
  await playRun(c, GAME, 'ranked', { plan: high });
  await playRun(c, GAME, 'ranked', { plan: low }); // not a new best: no event
  await playRun(c, GAME, 'practice', { plan: high }); // practice is not recorded
  const r = await anon.get<ActivityResponse>('/activity');
  expect(r.status).toBe(200);
  expect(r.body.items).toHaveLength(1);
  expect(r.body.items[0]).toMatchObject({ name: 'Ticker', text: `scored ${fmt(high!.score)} in`, game: gameMeta(GAME).name });
  expect((await anon.get<ActivityResponse>('/activity')).body).toEqual(r.body);
});

test('only the most recent events are returned', async () => {
  for (let i = 0; i < LIMITS.activityRows + 4; i++) await addActivity(t.ctx.db, 'P' + i, 'scored 1 in', 'Duck Dash', new Date(+t.now() + 60_000 + i * 1000));
  const items = (await new Client(t).get<ActivityResponse>('/activity')).body.items;
  expect(items).toHaveLength(LIMITS.activityRows);
  expect(items[0]!.name).toBe('P' + (LIMITS.activityRows + 3));
});

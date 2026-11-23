import { CUP_WINNERS, ECONOMY, GAME_KEYS, cupGame, cupStart, periodEnd, projectedPrize, type CupResponse, type GameKey, type StartRunResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client, errCode, freshApp, guest, ledgerCount, plan, playRun, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
let game: GameKey;
beforeAll(async () => {
  t = await freshApp();
  // Pick a week whose Cup game ends on its own without input, so the test does not depend on one game.
  for (let w = 0; w < 5; w++) {
    game = cupGame(t.now());
    if (plan(game, t.seed).dead && plan(game, t.seed).score > 0) return;
    t.advance(7 * 86_400_000);
  }
  throw new Error('no Cup game ends without input');
});
afterAll(() => t.close());

test('GET /cup is public and starts empty', async () => {
  const r = await new Client(t).get<CupResponse>('/cup');
  expect(r.status).toBe(200);
  const start = cupStart(t.now());
  expect(start.getUTCDay()).toBe(1); // Monday
  expect(r.body).toMatchObject({ game, entry: ECONOMY.cupEntry, pool: 0, rows: [], me: null, period: { startAt: start.toISOString(), endAt: periodEnd(start).toISOString() } });
  expect(r.body.payouts).toHaveLength(CUP_WINNERS);
});

test('Cup runs need a signed-in adult account and the Cup game', async () => {
  expect((await (await visitor(t)).post('/runs', { game, mode: 'cup' })).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/runs', { game, mode: 'cup' }))).toBe('guest_not_allowed');
  const c = await signUp(t);
  const wrong = GAME_KEYS.find((k) => k !== game)!;
  expect((await c.post('/runs', { game: wrong, mode: 'cup' })).status).toBe(400);
  expect(await c.balance()).toBe(ECONOMY.startBalance);
});

test('a Cup run charges the Cup entry into the Cup pool and lands on the Cup board, once', async () => {
  const c = await signUp(t, { name: 'Cupper' });
  const first = await c.post<StartRunResponse>('/runs', { game, mode: 'cup' }, { idem: 'cup-start-0001' });
  const again = await c.post<StartRunResponse>('/runs', { game, mode: 'cup' }, { idem: 'cup-start-0001' });
  expect(first.status).toBe(200);
  expect(again.body).toEqual(first.body);
  expect(first.body).toMatchObject({ entry: ECONOMY.cupEntry, balance: ECONOMY.startBalance - ECONOMY.cupEntry });
  expect(await ledgerCount(t, c.id, 'entry')).toBe(1);
  const played = await playRun(c, game, 'cup');
  expect(played.finish.status).toBe(200);
  const pool = 2 * ECONOMY.cupEntry;
  expect(played.finish.body).toMatchObject({ mode: 'cup', score: played.plan.score, place: 1, newBest: true, prizeIfHeld: projectedPrize(pool, ECONOMY.cupSplit, 1) });
  const cup = (await c.get<CupResponse>('/cup')).body;
  expect(cup.pool).toBe(pool);
  expect(cup.payouts).toEqual(ECONOMY.cupSplit.map((_, i) => projectedPrize(pool, ECONOMY.cupSplit, i + 1)));
  expect(cup.rows.map((r) => [r.place, r.name, r.score])).toEqual([[1, 'Cupper', played.plan.score]]);
  expect(cup.me).toEqual({ place: 1, score: played.plan.score });
  // The weekly board of the same game is a different board.
  expect((await t.ctx.db.period.findFirst({ where: { kind: 'weekly', game } }))?.pool ?? 0).toBe(0);
  expect((await new Client(t).get<CupResponse>('/cup')).body.rows).toEqual(cup.rows);
});

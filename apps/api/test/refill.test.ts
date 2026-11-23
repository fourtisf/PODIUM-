import { ECONOMY, type RefillResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { errCode, freshApp, ledgerCount, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('refill needs a session and an Idempotency-Key', async () => {
  const v = await visitor(t);
  expect((await v.post('/refill')).status).toBe(401);
  const c = await signUp(t);
  const r = await c.post('/refill', {}, { idem: null });
  expect(r.status).toBe(400);
  expect(errCode(r)).toBe('invalid');
});

test('refill is refused at or above the threshold', async () => {
  const c = await signUp(t);
  expect(errCode(await c.post('/refill'))).toBe('conflict');
  await t.ctx.db.user.update({ where: { id: c.id }, data: { balance: ECONOMY.refillUnder } });
  expect((await c.post('/refill')).status).toBe(409);
  expect(await ledgerCount(t, c.id, 'refill')).toBe(0);
});

test('refill tops the balance up to the refill amount; a replay does not pay twice', async () => {
  const c = await signUp(t);
  const low = ECONOMY.refillUnder - 37;
  await t.ctx.db.user.update({ where: { id: c.id }, data: { balance: low } });
  expect((await c.me()).canRefill).toBe(true);
  const first = await c.post<RefillResponse>('/refill', {}, { idem: 'refill-key-0001' });
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ added: ECONOMY.refillTo - low, balance: ECONOMY.refillTo });
  const replay = await c.post<RefillResponse>('/refill', {}, { idem: 'refill-key-0001' });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(replay.headers['idempotent-replay']).toBe('true');
  expect(await c.balance()).toBe(ECONOMY.refillTo);
  expect(await ledgerCount(t, c.id, 'refill')).toBe(1);
  // A new request is judged afresh: the balance is no longer under the threshold.
  expect((await c.post('/refill')).status).toBe(409);
  expect((await c.me()).canRefill).toBe(false);
});

test('two concurrent refills pay once', async () => {
  const c = await signUp(t);
  await t.ctx.db.user.update({ where: { id: c.id }, data: { balance: 0 } });
  const rs = await Promise.all([c.post('/refill'), c.post('/refill'), c.post('/refill')]);
  expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  expect(await c.balance()).toBe(ECONOMY.refillTo);
});

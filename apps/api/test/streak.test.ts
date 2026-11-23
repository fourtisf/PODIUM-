import { ECONOMY, STREAK, STREAK_BOX_INDEX, dayNum, type StreakClaimResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { errCode, freshApp, guest, ledgerCount, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());
const DAY = 86_400_000;

test('the streak needs a signed-in adult account and an Idempotency-Key', async () => {
  expect((await (await visitor(t)).post('/streak/claim')).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/streak/claim'))).toBe('guest_not_allowed');
  expect((await (await signUp(t, { unlocked: true })).post('/streak/claim', {}, { idem: null })).status).toBe(400);
});

test('one claim per UTC day; consecutive days climb; a missed day resets; replays do not pay twice', async () => {
  const c = await signUp(t, { unlocked: true });
  const d1 = await c.post<StreakClaimResponse>('/streak/claim', {}, { idem: 'streak-key-001' });
  expect(d1.status).toBe(200);
  expect(d1.body).toEqual({ day: 1, box: false, chips: STREAK[0], nominal: STREAK[0], scaled: false, balance: ECONOMY.startBalance + STREAK[0], boxes: ECONOMY.startBoxes });
  expect((await c.post<StreakClaimResponse>('/streak/claim', {}, { idem: 'streak-key-001' })).body).toEqual(d1.body);
  const dup = await c.post('/streak/claim');
  expect([dup.status, errCode(dup)]).toEqual([409, 'conflict']);
  expect(await ledgerCount(t, c.id, 'streak')).toBe(1);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: c.id, reason: 'streak' } })).idemKey).toBe(`streak:${c.id}:${dayNum(t.now())}`);
  expect((await c.me()).streak).toEqual({ claimedToday: true, nextDay: 1, amount: STREAK[0], box: false });

  t.advance(DAY);
  expect((await c.me()).streak).toEqual({ claimedToday: false, nextDay: 2, amount: STREAK[1], box: false });
  const d2 = await c.post<StreakClaimResponse>('/streak/claim');
  expect(d2.body).toMatchObject({ day: 2, chips: STREAK[1], balance: ECONOMY.startBalance + STREAK[0] + STREAK[1] });

  t.advance(2 * DAY); // a day was missed
  expect((await c.me()).streak.nextDay).toBe(1);
  expect((await c.post<StreakClaimResponse>('/streak/claim')).body).toMatchObject({ day: 1, chips: STREAK[0] });
  const notes = await t.ctx.db.notification.findMany({ where: { userId: c.id, kind: 'streak' } });
  expect(notes.map((n) => n.body).sort()).toEqual(['Daily streak day <b>1</b> claimed.', 'Daily streak day <b>1</b> claimed.', 'Daily streak day <b>2</b> claimed.']);
});

test('day seven pays the top amount and a mystery box, then the cycle repeats', async () => {
  const c = await signUp(t, { unlocked: true });
  await t.ctx.db.user.update({ where: { id: c.id }, data: { streak: STREAK_BOX_INDEX, streakDay: dayNum(t.now()) - 1 } });
  expect((await c.me()).streak).toEqual({ claimedToday: false, nextDay: 7, amount: STREAK[6], box: true });
  const d7 = await c.post<StreakClaimResponse>('/streak/claim');
  expect(d7.body).toMatchObject({ day: 7, box: true, chips: STREAK[STREAK_BOX_INDEX], boxes: ECONOMY.startBoxes + 1 });
  t.advance(DAY);
  expect((await c.post<StreakClaimResponse>('/streak/claim')).body).toMatchObject({ day: 8, box: false, chips: STREAK[0] });
});

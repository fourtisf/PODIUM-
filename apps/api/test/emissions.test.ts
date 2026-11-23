import { EMISSIONS, STREAK, dayNum, scaleEmission, type BoxOpenResponse, type SeasonClaimResponse, type StreakClaimResponse, SEASON } from '@podium/shared';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { emissionBudget } from '../src/services/ledger';
import { freshApp, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());
beforeEach(async () => void (await t.ctx.db.counter.deleteMany()));

const day = (): number => dayNum(t.now());
const setCounter = (key: string, value: number): Promise<unknown> => t.ctx.db.counter.upsert({ where: { key }, create: { key, value }, update: { value } });
const emitted = async (): Promise<number> => (await t.ctx.db.counter.findUnique({ where: { key: 'emitted:' + day() } }))?.value ?? 0;

test('rewards are paid from the daily budget and tracked', async () => {
  const c = await signUp(t, { unlocked: true });
  expect(await emissionBudget(t.ctx.db, t.now())).toBe(EMISSIONS.dailyBase);
  const r = await c.post<StreakClaimResponse>('/streak/claim');
  expect(r.body).toMatchObject({ chips: STREAK[0], nominal: STREAK[0], scaled: false });
  expect(await emitted()).toBe(STREAK[0]);
});

test('yesterday\'s fees add to today\'s budget', async () => {
  await setCounter('fees:' + (day() - 1), 1234);
  await setCounter('fees:' + day(), 999_999); // today's fees fund tomorrow, not today
  expect(await emissionBudget(t.ctx.db, t.now())).toBe(EMISSIONS.dailyBase + 1234);
});

test('a low budget scales rewards down and an empty one pays nothing; XP and boxes are not scaled', async () => {
  const budget = EMISSIONS.dailyBase;
  const nominal = STREAK[0];
  // Under the low-water mark: half the reward.
  const spentLow = budget - Math.floor(budget * EMISSIONS.lowWater) + 1;
  await setCounter('emitted:' + day(), spentLow);
  const a = await signUp(t, { unlocked: true });
  const half = await a.post<StreakClaimResponse>('/streak/claim', {}, { idem: 'emission-key-01' });
  expect(half.body).toMatchObject({ chips: Math.floor(nominal * EMISSIONS.lowScale), nominal, scaled: true });
  expect(half.body.chips).toBe(scaleEmission(nominal, budget, spentLow));
  expect(await emitted()).toBe(spentLow + half.body.chips);
  // A replay reports the same amount and emits nothing more.
  expect((await a.post<StreakClaimResponse>('/streak/claim', {}, { idem: 'emission-key-01' })).body).toEqual(half.body);
  expect(await emitted()).toBe(spentLow + half.body.chips);

  // Nearly empty: only what is left.
  await setCounter('emitted:' + day(), budget - 7);
  const b = await signUp(t, { unlocked: true });
  const rest = await b.post<StreakClaimResponse>('/streak/claim');
  expect(rest.body).toMatchObject({ chips: 7, nominal, scaled: true });
  expect(await emitted()).toBe(budget);

  // Empty: the claim still succeeds (the streak advances, XP and boxes are given) but pays no tChips.
  const c = await signUp(t, { unlocked: true });
  const none = await c.post<StreakClaimResponse>('/streak/claim');
  expect(none.body).toMatchObject({ day: 1, chips: 0, nominal, scaled: true });
  expect(await emitted()).toBe(budget);
  expect((await c.me()).streak.claimedToday).toBe(true);
  await t.ctx.db.user.update({ where: { id: c.id }, data: { xp: SEASON[1]!.xp } });
  const season = await c.post<SeasonClaimResponse>('/season/0/claim');
  expect(season.body).toMatchObject({ chips: 0, scaled: true });
  const boxTier = await c.post<SeasonClaimResponse>('/season/1/claim');
  expect(boxTier.body.boxes).toBe(2); // the box itself is not scaled
  const opened = await c.post<BoxOpenResponse>('/boxes/open');
  if (opened.body.prize.kind === 'chips') expect(opened.body.prize.chips).toBe(0);
  if (opened.body.prize.kind === 'xp') expect(opened.body.prize.amount).toBeGreaterThan(0);
  expect(await emitted()).toBe(budget);
});

test('concurrent claims cannot overspend the budget', async () => {
  const budget = EMISSIONS.dailyBase;
  const left = 130;
  await setCounter('emitted:' + day(), budget - left);
  const players = await Promise.all(Array.from({ length: 6 }, () => signUp(t, { unlocked: true })));
  const rs = await Promise.all(players.map((p) => p.post<StreakClaimResponse>('/streak/claim')));
  expect(rs.every((r) => r.status === 200)).toBe(true);
  const paid = rs.map((r) => r.body.chips);
  expect(paid.reduce((x, y) => x + y, 0)).toBe(left);
  expect(await emitted()).toBe(budget);
  const balances = await Promise.all(players.map((p) => p.balance()));
  expect(balances.reduce((x, y) => x + y, 0)).toBe(players.length * 2000 + left);
});

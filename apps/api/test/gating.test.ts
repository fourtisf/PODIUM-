import { ANTI_ABUSE, ECONOMY, REFERRAL, STREAK, weekKey, type MeResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { GAME, distinctPlans, errCode, freshApp, ledgerCount, playRun, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('mission and streak rewards unlock after the minimum number of validated ranked runs', async () => {
  const [p] = distinctPlans(GAME, t.seed, 1);
  const c = await signUp(t);
  let me: MeResponse = await c.me();
  expect(me).toMatchObject({ rewardsUnlocked: false, validatedRuns: 0, validatedRunsNeeded: ANTI_ABUSE.minValidatedRuns });
  const locked = await c.post('/streak/claim');
  expect([locked.status, errCode(locked)]).toEqual([403, 'rewards_locked']);
  expect((locked.body as { error: { details: { runsLeft: number } } }).error.details.runsLeft).toBe(ANTI_ABUSE.minValidatedRuns);
  expect((await c.post('/missions/p5/claim')).status === 403 || (await c.post('/missions/r3/claim')).status === 403).toBe(true);

  // Practice runs and rejected ranked runs do not count.
  await playRun(c, GAME, 'practice', { plan: p });
  expect((await playRun(c, GAME, 'ranked', { plan: p, waitMs: 0 })).finish.status).toBe(422);
  expect((await c.me()).validatedRuns).toBe(0);
  for (let i = 0; i < ANTI_ABUSE.minValidatedRuns; i++) {
    expect((await c.me()).rewardsUnlocked).toBe(false);
    expect((await playRun(c, GAME, 'ranked', { plan: p })).finish.status).toBe(200);
  }
  me = await c.me();
  expect(me).toMatchObject({ rewardsUnlocked: true, validatedRuns: ANTI_ABUSE.minValidatedRuns });
  const before = me.user.balance;
  expect((await c.post('/streak/claim')).status).toBe(200);
  expect(await c.balance()).toBe(before + STREAK[0]);

  // A flagged account is locked again, whatever its run count.
  await t.ctx.db.user.update({ where: { id: c.id }, data: { flagged: true } });
  t.advance(86_400_000);
  const held = await c.post('/streak/claim');
  expect(errCode(held)).toBe('rewards_locked');
  expect((await c.me()).rewardsUnlocked).toBe(false);
});

test('the inviter is paid once the invited player has done the ranked runs, if the inviter is eligible', async () => {
  const [p] = distinctPlans(GAME, t.seed, 1);
  const inviter = await signUp(t, { name: 'Host' });
  const ref = (await inviter.me()).user.refCode;
  const invited = await signUp(t, { name: 'Friend', ref });
  for (let i = 0; i < REFERRAL.rankedRunsNeeded; i++) await playRun(invited, GAME, 'ranked', { plan: p });
  // The inviter has no validated runs yet: the reward waits.
  expect(await inviter.balance()).toBe(ECONOMY.startBalance);
  expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: invited.id } })).refPaid).toBe(false);

  await t.ctx.db.user.update({ where: { id: inviter.id }, data: { validatedRanked: ANTI_ABUSE.minValidatedRuns } });
  await playRun(invited, GAME, 'ranked', { plan: p });
  expect(await inviter.balance()).toBe(ECONOMY.startBalance + REFERRAL.inviterBonus);
  await playRun(invited, GAME, 'ranked', { plan: p });
  expect(await inviter.balance()).toBe(ECONOMY.startBalance + REFERRAL.inviterBonus); // once per invited player
  expect(await ledgerCount(t, inviter.id, 'referral')).toBe(1);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: inviter.id, reason: 'referral' } })).idemKey).toBe(`referral:inviter:${invited.id}`);
  expect(await t.ctx.db.referralReward.count({ where: { inviterId: inviter.id, week: weekKey(t.now()) } })).toBe(1);
  const note = await t.ctx.db.notification.findFirstOrThrow({ where: { userId: inviter.id, kind: 'referral' } });
  expect(note.body).toContain('<b>Friend</b>');
});

test('inviter rewards are capped per week', async () => {
  const [p] = distinctPlans(GAME, t.seed, 1);
  const inviter = await signUp(t, { name: 'Popular', unlocked: true });
  const ref = (await inviter.me()).user.refCode;
  await t.ctx.db.referralReward.createMany({
    data: Array.from({ length: REFERRAL.inviterWeeklyCap }, (_, i) => ({ inviterId: inviter.id, invitedId: 'earlier-' + i, week: weekKey(t.now()) })),
  });
  const invited = await signUp(t, { ref });
  for (let i = 0; i < REFERRAL.rankedRunsNeeded; i++) await playRun(invited, GAME, 'ranked', { plan: p });
  expect(await inviter.balance()).toBe(ECONOMY.startBalance);
  // Next week the cap is fresh and the pending reward is paid on the invited player's next ranked run.
  t.advance(7 * 86_400_000);
  await playRun(invited, GAME, 'ranked', { plan: p });
  expect(await inviter.balance()).toBe(ECONOMY.startBalance + REFERRAL.inviterBonus);
});

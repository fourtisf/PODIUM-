import { ANTI_ABUSE, ECONOMY, SEASON, STREAK, dayNum, missionsForDay, type MeResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { errCode, freshApp, guest, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('GET /me needs a session', async () => {
  const v = await visitor(t);
  const r = await v.get('/me');
  expect(r.status).toBe(401);
  expect(errCode(r)).toBe('unauthorized');
});

test('GET /me returns the whole profile from the server', async () => {
  const c = await signUp(t, { name: 'Profile' });
  const me = await c.me();
  expect(me.user).toMatchObject({
    id: c.id, name: 'Profile', guest: false, adult: true, frame: 'none', balance: ECONOMY.startBalance, xp: 0, level: 1,
    boxes: ECONOMY.startBoxes, freePractice: ECONOMY.freePracticeRuns, flagged: false,
    stats: { plays: 0, spent: 0, won: 0, duelsWon: 0, duelsLost: 0 },
  });
  expect(me.user.refCode).toMatch(/^[A-Z2-9]{8}$/);
  expect(me.streak).toEqual({ claimedToday: false, nextDay: 1, amount: STREAK[0], box: false });
  expect(me.missions.map((m) => m.id)).toEqual(missionsForDay(dayNum(t.now())).map((m) => m.id));
  expect(me.missions.every((m) => m.progress === 0 && !m.claimed)).toBe(true);
  expect(me.missionsBonusClaimed).toBe(false);
  expect(me.season).toHaveLength(SEASON.length);
  expect(me.season[0]).toMatchObject({ tier: 0, xp: SEASON[0]!.xp, claimed: false, ready: false });
  expect(me).toMatchObject({ unread: 0, canRefill: false, rewardsUnlocked: false, validatedRuns: 0, validatedRunsNeeded: ANTI_ABUSE.minValidatedRuns });
  expect(me.csrf).toBe(c.csrf);
  expect(Math.abs(+new Date(me.serverTime) - +t.now())).toBeLessThan(5000);
});

test('PATCH /me changes name, avatar and frame under the rules; repeating it changes nothing', async () => {
  const c = await signUp(t, { name: 'Before' });
  const other = await signUp(t, { name: 'Occupied' });
  expect(other.name).toBe('Occupied');
  const ok = await c.patch<MeResponse>('/me', { name: 'After_1', avatar: 5 });
  expect(ok.status).toBe(200);
  expect(ok.body.user).toMatchObject({ name: 'After_1', avatar: 5 });
  const again = await c.patch<MeResponse>('/me', { name: 'After_1', avatar: 5 });
  expect(again.status).toBe(200);
  expect(again.body.user).toEqual(ok.body.user);
  expect((await c.patch('/me', { name: 'occupied' })).status).toBe(409);
  expect((await c.patch('/me', { name: 'Guest123' })).status).toBe(400);
  expect((await c.patch('/me', { name: 'x' })).status).toBe(400);
  expect((await c.patch('/me', { avatar: 13 })).status).toBe(403); // premium, not owned
  expect((await c.patch('/me', { frame: 'mint' })).status).toBe(403);
  expect((await c.patch('/me', { frame: 'nope' })).status).toBe(403);
  expect((await c.patch('/me', { balance: 999999 })).status).toBe(400); // nothing else can be set from the browser
  await t.ctx.db.item.create({ data: { userId: c.id, kind: 'frame', ref: 'mint' } });
  expect((await c.patch<MeResponse>('/me', { frame: 'mint' })).body.user.frame).toBe('mint');
  expect((await c.me()).user).toMatchObject({ name: 'After_1', avatar: 5, frame: 'mint', balance: ECONOMY.startBalance });
});

test('PATCH /me: no session → 401; a guest cannot choose a name', async () => {
  const v = await visitor(t);
  expect((await v.patch('/me', { avatar: 1 })).status).toBe(401);
  const g = await guest(t);
  expect(errCode(await g.patch('/me', { name: 'Sneaky' }))).toBe('guest_not_allowed');
  expect((await g.patch<MeResponse>('/me', { avatar: 3 })).body.user.avatar).toBe(3);
});

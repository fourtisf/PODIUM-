import { ECONOMY, SEASON, SEASON_NUMBER, type SeasonClaimResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { errCode, freshApp, guest, ledgerCount, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

const setXp = (id: string, xp: number): Promise<unknown> => t.ctx.db.user.update({ where: { id }, data: { xp } });
const amount = (tier: number): number => {
  const r = SEASON[tier]!.reward;
  if (r.kind !== 'chips') throw new Error('not a chips tier');
  return r.amount;
};

test('season claims need a signed-in adult account, an Idempotency-Key and a real tier', async () => {
  expect((await (await visitor(t)).post('/season/0/claim')).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/season/0/claim'))).toBe('guest_not_allowed');
  const c = await signUp(t);
  expect((await c.post('/season/0/claim', {}, { idem: null })).status).toBe(400);
  expect((await c.post('/season/99/claim')).status).toBe(404);
  expect((await c.post('/season/abc/claim')).status).toBe(400);
  expect((await c.post('/season/0/claim')).status).toBe(409); // not enough XP
});

test('tiers unlock by total XP and pay once: chips, a box, a cosmetic', async () => {
  const c = await signUp(t);
  await setXp(c.id, SEASON[1]!.xp);
  let me = await c.me();
  expect(me.season.map((s) => s.ready)).toEqual(SEASON.map((_, i) => i <= 1));

  const chips = await c.post<SeasonClaimResponse>('/season/0/claim', {}, { idem: 'season-key-0001' });
  expect(chips.status).toBe(200);
  expect(chips.body).toEqual({ tier: 0, reward: SEASON[0]!.reward, fallback: false, chips: amount(0), nominal: amount(0), scaled: false, balance: ECONOMY.startBalance + amount(0), boxes: ECONOMY.startBoxes });
  expect((await c.post<SeasonClaimResponse>('/season/0/claim', {}, { idem: 'season-key-0001' })).body).toEqual(chips.body);
  const dup = await c.post('/season/0/claim');
  expect([dup.status, errCode(dup)]).toEqual([409, 'conflict']);
  expect(await ledgerCount(t, c.id, 'season')).toBe(1);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: c.id, reason: 'season' } })).idemKey).toBe(`season:${c.id}:${SEASON_NUMBER}:0`);

  const box = await c.post<SeasonClaimResponse>('/season/1/claim');
  expect(SEASON[1]!.reward.kind).toBe('box');
  expect(box.body).toMatchObject({ tier: 1, chips: 0, boxes: ECONOMY.startBoxes + 1, balance: ECONOMY.startBalance + amount(0) });
  expect((await c.post('/season/2/claim')).status).toBe(409);

  await setXp(c.id, SEASON[3]!.xp);
  const frame = await c.post<SeasonClaimResponse>('/season/3/claim');
  expect(frame.body).toMatchObject({ tier: 3, reward: { kind: 'frame', frame: 'mint' }, fallback: false, chips: 0 });
  me = await c.me();
  expect(me.user.items.frames).toEqual(['none', 'mint']);
  expect(me.season.slice(0, 4).map((s) => [s.claimed, s.ready])).toEqual([[true, false], [true, false], [false, true], [true, false]]);
  expect(await c.balance()).toBe(ECONOMY.startBalance + amount(0));
});

test('a cosmetic the player already owns pays the fallback instead', async () => {
  const c = await signUp(t);
  await setXp(c.id, SEASON[7]!.xp);
  await t.ctx.db.item.create({ data: { userId: c.id, kind: 'avatar', ref: '13' } });
  const r = await c.post<SeasonClaimResponse>('/season/7/claim');
  expect(r.body).toMatchObject({ tier: 7, reward: { kind: 'avatar', avatar: 13 }, fallback: true, chips: ECONOMY.ownedCosmeticFallback, balance: ECONOMY.startBalance + ECONOMY.ownedCosmeticFallback });
  expect(await t.ctx.db.item.count({ where: { userId: c.id } })).toBe(1);
});

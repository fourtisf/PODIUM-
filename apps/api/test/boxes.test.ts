import { BOX, ECONOMY, FRAMES, PAID_FRAMES, PREMIUM_AVATARS, type BoxOpenResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { errCode, freshApp, guest, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('opening a box needs a signed-in adult account and an Idempotency-Key', async () => {
  expect((await (await visitor(t)).post('/boxes/open')).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/boxes/open'))).toBe('guest_not_allowed');
  expect((await (await signUp(t)).post('/boxes/open', {}, { idem: null })).status).toBe(400);
});

test('a box is opened once: the prize is fixed at the first call and returned again on replay', async () => {
  const c = await signUp(t);
  const before = await c.me();
  expect(before.user.boxes).toBe(ECONOMY.startBoxes);
  const first = await c.post<BoxOpenResponse>('/boxes/open', {}, { idem: 'box-open-key-1' });
  expect(first.status).toBe(200);
  expect(first.body.boxes).toBe(ECONOMY.startBoxes - 1);
  for (let i = 0; i < 3; i++) {
    const replay = await c.post<BoxOpenResponse>('/boxes/open', {}, { idem: 'box-open-key-1' });
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replay']).toBe('true');
  }
  const after = await c.me();
  expect(after.user.boxes).toBe(ECONOMY.startBoxes - 1);
  const p = first.body.prize;
  expect(after.user.balance - before.user.balance).toBe(p.kind === 'chips' ? p.chips : 0);
  expect(after.user.xp - before.user.xp).toBe(p.kind === 'xp' ? p.amount : 0);
  expect(await t.ctx.db.item.count({ where: { userId: c.id } })).toBe(p.kind === 'avatar' || p.kind === 'frame' ? 1 : 0);
  const none = await c.post('/boxes/open');
  expect([none.status, errCode(none)]).toEqual([409, 'conflict']);
});

test('prizes follow the box table and never repeat a cosmetic', async () => {
  const c = await signUp(t);
  const n = 150;
  await t.ctx.db.user.update({ where: { id: c.id }, data: { boxes: n } });
  const seen = { avatar: 0, frame: 0, xp: 0, chips: 0 };
  let chips = 0, xp = 0;
  const cosmetics = new Set<string>();
  for (let i = 0; i < n; i++) {
    const r = await c.post<BoxOpenResponse>('/boxes/open');
    expect(r.status).toBe(200);
    const p = r.body.prize;
    seen[p.kind]++;
    if (p.kind === 'xp') {
      expect(p.amount).toBeGreaterThanOrEqual(BOX.xpMin);
      expect(p.amount).toBeLessThanOrEqual(BOX.xpMax);
      expect(p.amount % BOX.step).toBe(0);
      xp += p.amount;
    } else if (p.kind === 'chips') {
      expect(p.nominal).toBeGreaterThanOrEqual(BOX.chipsMin);
      expect(p.nominal).toBeLessThanOrEqual(BOX.chipsMax);
      expect(p.nominal % BOX.step).toBe(0);
      expect(p.chips).toBe(p.nominal);
      chips += p.chips;
    } else {
      const key = p.kind === 'avatar' ? 'a' + p.avatar : 'f' + p.frame;
      expect(cosmetics.has(key)).toBe(false);
      cosmetics.add(key);
      if (p.kind === 'avatar') expect(p.name).toBe(PREMIUM_AVATARS[p.avatar]!.name);
      else expect(p.name).toBe(FRAMES[p.frame as keyof typeof FRAMES].name);
    }
  }
  const me = await c.me();
  expect(me.user).toMatchObject({ boxes: 0, balance: ECONOMY.startBalance + chips, xp });
  expect(seen.avatar + seen.frame).toBeLessThanOrEqual(Object.keys(PREMIUM_AVATARS).length + PAID_FRAMES.length);
  expect(me.user.items.avatars.length - 12 + me.user.items.frames.length - 1).toBe(seen.avatar + seen.frame);
  // 150 draws at 58% tChips / 26% XP: both kinds certainly show up.
  expect(seen.chips).toBeGreaterThan(40);
  expect(seen.xp).toBeGreaterThan(10);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: c.id, reason: 'box' } })).idemKey).toMatch(new RegExp(`^box:${c.id}:`));
});

test('concurrent opens cannot open more boxes than the player has', async () => {
  const c = await signUp(t);
  const rs = await Promise.all([1, 2, 3, 4].map(() => c.post('/boxes/open')));
  expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
  expect((await c.me()).user.boxes).toBe(0);
});

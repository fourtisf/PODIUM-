import { ECONOMY, FRAMES, PAID_FRAMES, PREMIUM_AVATARS, type ShopBuyResponse, type ShopResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client, errCode, freshApp, guest, ledgerCount, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());
const burnOf = (price: number): number => Math.round(price * ECONOMY.shopBurn);

test('GET /shop is public and lists prices from the shared constants', async () => {
  const r = await new Client(t).get<ShopResponse>('/shop');
  expect(r.status).toBe(200);
  expect(r.body.burned).toBe(0);
  expect(r.body.box).toEqual({ price: ECONOMY.boxPrice });
  expect(r.body.avatars).toEqual(Object.entries(PREMIUM_AVATARS).map(([id, a]) => ({ id: Number(id), name: a.name, price: a.price, owned: false })));
  expect(r.body.frames).toEqual(PAID_FRAMES.map((id) => ({ id, name: FRAMES[id].name, price: FRAMES[id].price, owned: false })));
});

test('buying needs a signed-in adult account and an Idempotency-Key', async () => {
  expect((await (await visitor(t)).post('/shop/buy', { kind: 'box' })).status).toBe(401);
  expect(errCode(await (await guest(t)).post('/shop/buy', { kind: 'box' }))).toBe('guest_not_allowed');
  const c = await signUp(t);
  expect((await c.post('/shop/buy', { kind: 'box' }, { idem: null })).status).toBe(400);
  expect((await c.post('/shop/buy', { kind: 'avatar', id: 3 })).status).toBe(400); // free avatars are not for sale
  expect((await c.post('/shop/buy', { kind: 'avatar', id: 99 })).status).toBe(400);
  expect((await c.post('/shop/buy', { kind: 'frame', id: 'none' })).status).toBe(400);
  expect((await c.post('/shop/buy', { kind: 'frame', id: 'gold' })).status).toBe(400);
  expect((await c.post('/shop/buy', { kind: 'car' })).status).toBe(400);
  expect((await c.post('/shop/buy', { kind: 'box', price: 1 })).status).toBe(200); // a price from the browser is ignored
  expect(await c.balance()).toBe(ECONOMY.startBalance - ECONOMY.boxPrice);
});

test('a purchase charges the shared price, burns its share and is applied once', async () => {
  const c = await signUp(t);
  const burned0 = (await c.get<ShopResponse>('/shop')).body.burned;
  const box = await c.post<ShopBuyResponse>('/shop/buy', { kind: 'box' }, { idem: 'shop-key-00001' });
  expect(box.status).toBe(200);
  expect(box.body).toEqual({ kind: 'box', id: null, price: ECONOMY.boxPrice, burned: burned0 + burnOf(ECONOMY.boxPrice), balance: ECONOMY.startBalance - ECONOMY.boxPrice, boxes: ECONOMY.startBoxes + 1 });
  expect((await c.post<ShopBuyResponse>('/shop/buy', { kind: 'box' }, { idem: 'shop-key-00001' })).body).toEqual(box.body);
  expect(await ledgerCount(t, c.id, 'shop')).toBe(1);
  expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: c.id, reason: 'shop' } })).idemKey).toBe(`shop:${c.id}:shop-key-00001`);

  const avatarId = 12;
  const price = PREMIUM_AVATARS[avatarId]!.price;
  const av = await c.post<ShopBuyResponse>('/shop/buy', { kind: 'avatar', id: avatarId });
  expect(av.body).toMatchObject({ kind: 'avatar', id: avatarId, price, balance: ECONOMY.startBalance - ECONOMY.boxPrice - price, burned: burned0 + burnOf(ECONOMY.boxPrice) + burnOf(price) });
  const owned = await c.post('/shop/buy', { kind: 'avatar', id: avatarId });
  expect([owned.status, errCode(owned)]).toEqual([409, 'conflict']);
  const fr = await c.post<ShopBuyResponse>('/shop/buy', { kind: 'frame', id: 'mint' });
  expect(fr.body).toMatchObject({ kind: 'frame', id: 'mint', price: FRAMES.mint.price });

  const me = await c.me();
  const spent = ECONOMY.boxPrice + price + FRAMES.mint.price;
  expect(me.user).toMatchObject({ avatar: avatarId, frame: 'mint', balance: ECONOMY.startBalance - spent, boxes: ECONOMY.startBoxes + 1, stats: { spent } }); // bought and equipped
  expect(me.user.items).toEqual({ avatars: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, avatarId], frames: ['none', 'mint'] });
  const shop = (await c.get<ShopResponse>('/shop')).body;
  expect(shop.burned).toBe(burned0 + burnOf(ECONOMY.boxPrice) + burnOf(price) + burnOf(FRAMES.mint.price));
  expect(shop.avatars.find((a) => a.id === avatarId)!.owned).toBe(true);
  expect(shop.frames.find((f) => f.id === 'mint')!.owned).toBe(true);
  expect((await new Client(t).get<ShopResponse>('/shop')).body.avatars.every((a) => !a.owned)).toBe(true);

  // Not enough tChips: nothing changes, nothing is burned.
  const poor = await c.post('/shop/buy', { kind: 'frame', id: 'aurora' });
  expect([poor.status, errCode(poor)]).toEqual([402, 'not_enough_chips']);
  expect((await c.get<ShopResponse>('/shop')).body.burned).toBe(shop.burned);
  expect((await c.me()).user.items.frames).toEqual(['none', 'mint']);
  expect(await c.balance()).toBe(ECONOMY.startBalance - spent);
});

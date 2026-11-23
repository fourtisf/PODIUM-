import type { NotificationsResponse } from '@podium/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { LIMITS } from '../src/config';
import { notify } from '../src/services/notifications';
import { esc } from '../src/util';
import { freshApp, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('the inbox needs a session', async () => {
  const v = await visitor(t);
  expect((await v.get('/notifications')).status).toBe(401);
  expect((await v.post('/notifications/read')).status).toBe(401);
});

test('latest notifications first, unread count, mark all read (and again)', async () => {
  const c = await signUp(t, { unlocked: true });
  const other = await signUp(t, { unlocked: true });
  expect((await c.get<NotificationsResponse>('/notifications')).body).toEqual({ items: [], unread: 0 });
  expect((await c.post('/streak/claim')).status).toBe(200);
  await other.post('/streak/claim');
  const one = (await c.get<NotificationsResponse>('/notifications')).body;
  expect(one.unread).toBe(1);
  expect(one.items).toHaveLength(1);
  expect(one.items[0]).toMatchObject({ kind: 'streak', body: 'Daily streak day <b>1</b> claimed.', read: false });
  expect((await c.me()).unread).toBe(1);

  for (let i = 0; i < LIMITS.notificationRows + 5; i++) await notify(t.ctx.db, c.id, 'test', `note ${i}`, new Date(+t.now() + 1000 + i));
  const many = (await c.get<NotificationsResponse>('/notifications')).body;
  expect(many.items).toHaveLength(LIMITS.notificationRows);
  expect(many.items[0]!.body).toBe(`note ${LIMITS.notificationRows + 4}`);
  expect(many.unread).toBe(LIMITS.notificationRows + 6);

  expect((await c.post('/notifications/read')).body).toEqual({ ok: true });
  expect((await c.post('/notifications/read')).body).toEqual({ ok: true });
  const read = (await c.get<NotificationsResponse>('/notifications')).body;
  expect(read.unread).toBe(0);
  expect(read.items.every((n) => n.read)).toBe(true);
  // Someone else's inbox is untouched.
  expect((await other.get<NotificationsResponse>('/notifications')).body.unread).toBe(1);
});

test('bodies carry only <b> tags written by the server; names are escaped', async () => {
  expect(esc('<img src=x onerror=1>&"\'')).toBe('&lt;img src=x onerror=1&gt;&amp;&quot;&#39;');
  const rows = await t.ctx.db.notification.findMany({ where: { kind: { not: 'test' } } });
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.body.replace(/<\/?b>/g, '')).not.toMatch(/[<>]/);
});

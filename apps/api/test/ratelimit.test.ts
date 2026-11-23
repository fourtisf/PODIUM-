import { afterAll, beforeAll, expect, test } from 'vitest';
import { RATE } from '../src/config';
import { Client, errCode, freshApp, guest, type TestApp } from './helpers';

let t: TestApp;
const scale = 5 / RATE.mutationPerUser[0]; // five mutations a minute per user, ten per device, twenty per IP
beforeAll(async () => void (t = await freshApp({ config: { rateScale: scale } })));
afterAll(() => t.close());

test('mutations are limited per user, per device and per IP, with a JSON 429', async () => {
  const perUser = Math.ceil(RATE.mutationPerUser[0] * scale);
  const perDevice = Math.ceil(RATE.mutationPerDevice[0] * scale);
  const perIp = Math.ceil(RATE.mutationPerIp[0] * scale);
  expect([perUser, perDevice, perIp]).toEqual([5, 10, 20]);
  const a = await guest(t); // 1 IP hit, 1 device hit, 0 user hits (no user yet)
  const seen: number[] = [];
  for (let i = 0; i < perUser + 1; i++) seen.push((await a.post('/notifications/read')).status);
  expect(seen).toEqual([...Array(perUser).fill(200), 429]);
  const blocked = await a.post('/notifications/read');
  expect(blocked.body).toMatchObject({ error: { code: 'rate_limited' } });
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  expect((await a.get('/me')).status).toBe(200); // reads are not affected

  // The same device with fresh accounts runs into the device limit.
  const b = new Client(t);
  b.device = a.device;
  await b.start();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await b.post('/auth/guest')).status);
  expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  expect(errCode(await b.post('/auth/guest'))).toBe('rate_limited');

  // And many devices behind one address run into the IP limit.
  let last = 200;
  for (let i = 0; i < perIp && last !== 429; i++) last = (await (await new Client(t).start()).post('/auth/guest')).status;
  expect(last).toBe(429);

  // The window passes.
  t.advance(RATE.mutationPerUser[1] * 1000 + 1000);
  expect((await a.post('/notifications/read')).status).toBe(200);
});

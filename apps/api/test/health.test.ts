import { afterAll, beforeAll, expect, test } from 'vitest';
import { freshApp, visitor, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => void (t = await freshApp()));
afterAll(() => t.close());

test('GET /api/health checks the database and Redis', async () => {
  const c = await visitor(t);
  const r = await c.get('/health');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ ok: true });
});

test('unknown routes answer with the JSON error shape', async () => {
  const c = await visitor(t);
  const r = await c.get('/nope');
  expect(r.status).toBe(404);
  expect(r.body).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
});

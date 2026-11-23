import { describe, expect, it } from 'vitest';
import { ApiFailure, createClient, wsBase } from './api';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
type Reply = { status: number; body: unknown } | 'network';

function harness(script: (c: Call) => Reply) {
  const calls: Call[] = [];
  const mem = new Map<string, string>();
  let n = 0;
  const client = createClient({
    fetch: async (url, init) => {
      const call: Call = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const r = script(call);
      if (r === 'network') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    },
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) },
    uuid: () => `uuid-${++n}`,
  });
  return { client, calls, mem };
}

const ok = (body: unknown): Reply => ({ status: 200, body });

describe('api client', () => {
  it('sends the CSRF token and a stable device id on every mutation, and none on GET', async () => {
    const { client, calls, mem } = harness((c) => (c.url === '/api/auth/csrf' ? ok({ csrf: 'tok1' }) : ok({ ok: true })));
    await client.notificationsRead();
    await client.patchMe({ avatar: 2 });
    await client.games();
    const [csrf, read, patch, games] = calls;
    expect(csrf!.url).toBe('/api/auth/csrf');
    expect(read!.headers['x-csrf-token']).toBe('tok1');
    expect(patch!.method).toBe('PATCH');
    expect(patch!.headers['x-csrf-token']).toBe('tok1');
    expect(read!.headers['x-device']).toBe(patch!.headers['x-device']);
    expect(mem.get('podium.device')).toBe(read!.headers['x-device']);
    expect(games!.headers['x-csrf-token']).toBeUndefined();
    expect(games!.headers['x-device']).toBeUndefined();
    // Not money-like: no idempotency key.
    expect(read!.headers['Idempotency-Key']).toBeUndefined();
  });

  it('takes the token from /me and from sign-in answers', async () => {
    const { client, calls } = harness((c) => (c.url === '/api/me' ? ok({ csrf: 'from-me' }) : c.url === '/api/auth/guest' ? ok({ ok: true, csrf: 'after-guest' }) : ok({ ok: true })));
    await client.me();
    await client.guest();
    await client.notificationsRead();
    expect(calls[1]!.headers['x-csrf-token']).toBe('from-me');
    expect(calls[2]!.headers['x-csrf-token']).toBe('after-guest');
    expect(calls.some((c) => c.url === '/api/auth/csrf')).toBe(false);
  });

  it('refetches the token and retries once on a csrf 403, with the same idempotency key', async () => {
    let tokens = 0;
    const { client, calls } = harness((c) => {
      if (c.url === '/api/auth/csrf') return ok({ csrf: `tok${++tokens}` });
      return c.headers['x-csrf-token'] === 'tok1' ? ok({ added: 400, balance: 500 }) : { status: 403, body: { error: { code: 'csrf', message: 'stale' } } };
    });
    client.setCsrf('old');
    const r = await client.refill();
    expect(r.balance).toBe(500);
    const posts = calls.filter((c) => c.url === '/api/refill');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers['Idempotency-Key']).toBe(posts[1]!.headers['Idempotency-Key']);
    expect(posts[1]!.headers['x-csrf-token']).toBe('tok1');
  });

  it('does not loop when the retry is refused too', async () => {
    const { client, calls } = harness((c) => (c.url === '/api/auth/csrf' ? ok({ csrf: 't' }) : { status: 403, body: { error: { code: 'csrf', message: 'Missing or stale CSRF token.' } } }));
    await expect(client.claimStreak()).rejects.toMatchObject({ code: 'csrf', status: 403 });
    expect(calls.filter((c) => c.url === '/api/streak/claim')).toHaveLength(2);
  });

  it('reuses the Idempotency-Key when the same action is retried after a network error', async () => {
    let fail = true;
    const { client, calls } = harness((c) => {
      if (c.url === '/api/auth/csrf') return ok({ csrf: 't' });
      if (fail) return 'network';
      return ok({ kind: 'box', id: null, price: 300, burned: 30, balance: 1700, boxes: 2 });
    });
    await expect(client.shopBuy({ kind: 'box' })).rejects.toMatchObject({ code: 'network' });
    fail = false;
    await client.shopBuy({ kind: 'box' });
    await client.shopBuy({ kind: 'box' });
    const buys = calls.filter((c) => c.url === '/api/shop/buy');
    expect(buys).toHaveLength(3);
    expect(buys[0]!.headers['Idempotency-Key']).toBeTruthy();
    // The retry of the failed purchase carries the same key; the next purchase is a new action.
    expect(buys[1]!.headers['Idempotency-Key']).toBe(buys[0]!.headers['Idempotency-Key']);
    expect(buys[2]!.headers['Idempotency-Key']).not.toBe(buys[0]!.headers['Idempotency-Key']);
  });

  it('uses a new key after the server answered with an error', async () => {
    let n = 0;
    const { client, calls } = harness((c) => {
      if (c.url === '/api/auth/csrf') return ok({ csrf: 't' });
      return ++n === 1 ? { status: 402, body: { error: { code: 'not_enough_chips', message: 'Not enough tChips.' } } } : ok({ runId: 'r', seed: 1 });
    });
    const err = await client.startRun({ game: 'duck', mode: 'ranked' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).message).toBe('Not enough tChips.');
    expect((err as ApiFailure).code).toBe('not_enough_chips');
    await client.startRun({ game: 'duck', mode: 'ranked' });
    const runs = calls.filter((c) => c.url === '/api/runs');
    expect(runs[0]!.headers['Idempotency-Key']).not.toBe(runs[1]!.headers['Idempotency-Key']);
    expect(runs[0]!.body).toEqual({ game: 'duck', mode: 'ranked' });
  });

  it('keys different actions separately', async () => {
    const { client, calls } = harness((c) => (c.url === '/api/auth/csrf' ? ok({ csrf: 't' }) : 'network'));
    await client.claimMission('r3').catch(() => undefined);
    await client.claimMission('pb').catch(() => undefined);
    await client.claimMission('r3').catch(() => undefined);
    const k = calls.filter((c) => c.url.includes('/missions/')).map((c) => c.headers['Idempotency-Key']);
    expect(k[0]).not.toBe(k[1]);
    expect(k[2]).toBe(k[0]);
  });
});

describe('wsBase', () => {
  it('uses the same origin with the matching scheme outside development', () => {
    expect(wsBase({ protocol: 'https:', host: 'podium.example', hostname: 'podium.example' })).toBe('wss://podium.example');
    expect(wsBase({ protocol: 'http:', host: 'localhost:3000', hostname: 'localhost' })).toBe('ws://localhost:3000');
  });
});

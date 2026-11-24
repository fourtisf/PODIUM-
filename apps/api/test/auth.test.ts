import { ECONOMY, REFERRAL, type AuthResponse, type MeResponse, type WalletNonceResponse } from '@podium/shared';
import bs58 from 'bs58';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { HttpFetch } from '../src/ctx';
import { Client, errCode, freshApp, guest, ledgerCount, makeApp, signUp, visitor, type TestApp } from './helpers';

let t: TestApp;
const google = { sub: 'google-sub-1', email: 'gina@example.com', email_verified: true as boolean, fail: false };
const http: HttpFetch = async (url) => {
  if (url.includes('oauth2.googleapis.com/token')) return { ok: !google.fail, status: google.fail ? 400 : 200, json: async () => ({ access_token: 'at-1' }) };
  if (url.includes('userinfo')) return { ok: true, status: 200, json: async () => ({ sub: google.sub, email: google.email, email_verified: google.email_verified }) };
  throw new Error('unexpected url ' + url);
};
beforeAll(async () => void (t = await freshApp({ http })));
afterAll(() => t.close());

async function code(c: Client, email: string): Promise<string> {
  expect((await c.post('/auth/email/request', { email })).status).toBe(200);
  return t.ctx.devCodes.get(email)!;
}

describe('guest', () => {
  test('a mutation without a CSRF token is refused', async () => {
    const c = new Client(t);
    expect(errCode(await c.post('/auth/guest'))).toBe('csrf');
    await c.start();
    expect((await c.post('/auth/guest', {}, { csrf: 'wrong' })).status).toBe(403);
  });

  test('cross-origin mutations are refused', async () => {
    const c = await visitor(t);
    const r = await c.post('/auth/guest', {}, { headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
    expect((await c.post('/auth/guest', {}, { headers: { origin: 'http://localhost:3000' } })).status).toBe(200);
  });

  test('creates a guest account with the starting economy, once per session', async () => {
    const c = await visitor(t);
    expect((await c.get('/me')).status).toBe(401);
    const a = await c.post<AuthResponse>('/auth/guest');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, guest: true, created: true });
    expect(a.body.name).toMatch(/^Guest\d+$/);
    const again = await c.post<AuthResponse>('/auth/guest');
    expect(again.body.userId).toBe(a.body.userId);
    expect(again.body.created).toBe(false);
    const me = await c.me();
    expect(me.user).toMatchObject({ guest: true, adult: false, balance: ECONOMY.startBalance, boxes: ECONOMY.startBoxes, freePractice: ECONOMY.freePracticeRuns });
    expect(me.user.items.avatars).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(me.user.items.frames).toEqual(['none']);
    const row = await t.ctx.db.user.findUniqueOrThrow({ where: { id: a.body.userId } });
    expect(row.deviceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.lastIp).toBeTruthy();
  });
});

describe('email code', () => {
  test('age gate, wrong code, then sign-up; the code cannot be replayed', async () => {
    const c = await visitor(t);
    const email = 'ada@example.com';
    const k = await code(c, email);
    expect(k).toMatch(/^\d{6}$/);
    const wrong = k === '000000' ? '000001' : '000000';
    expect((await c.post('/auth/email/verify', { email, code: wrong, adult: true })).status).toBe(400);
    const minor = await c.post('/auth/email/verify', { email, code: k, adult: false });
    expect(minor.status).toBe(403);
    expect(errCode(minor)).toBe('not_adult');
    expect(await t.ctx.db.user.count({ where: { email } })).toBe(0);
    const ok = await c.post<AuthResponse>('/auth/email/verify', { email: 'ADA@example.com', code: k, adult: true, name: 'Ada' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ guest: false, adult: true, created: true, name: 'Ada' });
    expect((await c.me()).user).toMatchObject({ name: 'Ada', guest: false, adult: true, balance: ECONOMY.startBalance });
    // Replaying the verify call: the code is spent, and no second account appears.
    const replay = await c.post('/auth/email/verify', { email, code: k, adult: true, name: 'Ada2' });
    expect(replay.status).toBe(400);
    expect(await t.ctx.db.user.count({ where: { email } })).toBe(1);
  });

  test('five wrong guesses burn the code', async () => {
    const c = await visitor(t);
    const email = 'burn@example.com';
    const k = await code(c, email);
    const wrong = k === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/email/verify', { email, code: wrong, adult: true })).status).toBe(400);
    expect((await c.post('/auth/email/verify', { email, code: k, adult: true })).status).toBe(400);
  });

  test('signing in from a guest session upgrades the same account', async () => {
    const g = await guest(t);
    await t.ctx.db.user.update({ where: { id: g.id }, data: { xp: 77 } });
    const oldCsrf = g.csrf;
    const c = await signUp(t, { from: g, name: 'Keeper' });
    expect(c.id).toBe(g.id);
    expect(c.csrf).not.toBe(oldCsrf); // the session id is rotated on sign-in
    expect((await c.me()).user).toMatchObject({ id: g.id, guest: false, xp: 77, name: 'Keeper' });
  });

  test('an identity that already has an account switches the session to it', async () => {
    const first = await signUp(t, { email: 'same@example.com', name: 'Samey' });
    const g = await guest(t);
    const guestId = g.id;
    const second = await signUp(t, { from: g, email: 'same@example.com' });
    expect(second.id).toBe(first.id);
    expect(second.id).not.toBe(guestId);
    expect((await second.me()).user.name).toBe('Samey');
  });

  test('display name rules', async () => {
    await signUp(t, { name: 'Taken.Name' });
    for (const [name, status] of [['Guestimate', 400], ['Playerone', 400], ['ab', 400], ['bad<name>', 400], ['taken.name', 409]] as const) {
      const c = await visitor(t);
      const email = `n${Math.random().toString(36).slice(2)}@example.com`;
      const k = await code(c, email);
      const r = await c.post('/auth/email/verify', { email, code: k, adult: true, name });
      expect([name, r.status]).toEqual([name, status]);
    }
    const auto = await signUp(t);
    expect(auto.name).toMatch(/^Player\d+$/);
  });

  test('referral: the invited player gets the bonus once; self-referral is ignored', async () => {
    const inviter = await signUp(t, { name: 'Inviter' });
    const ref = (await inviter.me()).user.refCode;
    const invited = await signUp(t, { ref });
    expect(await invited.balance()).toBe(ECONOMY.startBalance + REFERRAL.invitedBonus);
    expect(await ledgerCount(t, invited.id, 'referral')).toBe(1);
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: invited.id } })).referredById).toBe(inviter.id);
    expect(await inviter.balance()).toBe(ECONOMY.startBalance); // the inviter is paid later, after ranked runs
    // Signing in again with the code changes nothing.
    const again = await signUp(t, { email: invited.email, ref });
    expect(again.id).toBe(invited.id);
    expect(await again.balance()).toBe(ECONOMY.startBalance + REFERRAL.invitedBonus);
    // Same device as the inviter (inviting yourself): no bonus.
    const self = await visitor(t);
    self.device = inviter.device;
    const s = await signUp(t, { from: self, ref });
    expect(await s.balance()).toBe(ECONOMY.startBalance);
    const unknown = await signUp(t, { ref: 'ZZZZZZZZ' });
    expect(await unknown.balance()).toBe(ECONOMY.startBalance);
  });
});

/** A throwaway Solana wallet: base58 address plus a signer returning base58 signatures. */
function solanaWallet(): { address: string; sign(message: string): string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { address: bs58.encode(raw), sign: (m) => bs58.encode(edSign(null, Buffer.from(m, 'utf8'), privateKey)) };
}

describe('wallet (identity only)', () => {
  test('nonce, signature, sign-in; a used nonce cannot be replayed', async () => {
    const account = solanaWallet();
    const c = await visitor(t);
    const n = await c.post<WalletNonceResponse>('/auth/wallet/nonce', { address: account.address });
    expect(n.status).toBe(200);
    expect(n.body.message).toContain(n.body.nonce);
    expect(n.body.message).toContain('does not send a transaction');
    const signature = account.sign(n.body.message);
    const other = solanaWallet().sign(n.body.message);
    expect((await c.post('/auth/wallet/verify', { address: account.address, signature: other, adult: true })).status).toBe(400);
    expect((await c.post('/auth/wallet/verify', { address: account.address, signature: account.sign(n.body.message + 'x'), adult: true })).status).toBe(400);
    expect(errCode(await c.post('/auth/wallet/verify', { address: account.address, signature, adult: false }))).toBe('not_adult');
    const ok = await c.post<AuthResponse>('/auth/wallet/verify', { address: account.address, signature, adult: true, name: 'Wally' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ guest: false, adult: true, created: true, name: 'Wally' });
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: ok.body.userId } })).wallet).toBe(account.address);
    const replay = await c.post('/auth/wallet/verify', { address: account.address, signature, adult: true });
    expect(replay.status).toBe(400);
    expect(await t.ctx.db.user.count({ where: { wallet: account.address } })).toBe(1);
    expect((await c.post('/auth/wallet/nonce', { address: 'not-an-address' })).status).toBe(400);
    expect((await c.post('/auth/wallet/nonce', { address: '0x52908400098527886E0F7030069857D2E4169EE7' })).status).toBe(400);
  });
});

describe('wallet unlink', () => {
  test('removes a linked wallet from an email account; refused when the wallet is the only sign-in; idempotent; guests and visitors refused', async () => {
    // Email account + linked wallet → can unlink.
    const c = await signUp(t);
    const w = solanaWallet();
    const n = await c.post<WalletNonceResponse>('/auth/wallet/nonce', { address: w.address });
    expect((await c.post('/auth/wallet/link', { address: w.address, signature: w.sign(n.body.message) })).status).toBe(200);
    let me = await c.get<MeResponse>('/me');
    expect(me.body.user).toMatchObject({ wallet: w.address, canUnlinkWallet: true });
    expect((await c.post('/auth/wallet/unlink', {})).status).toBe(200);
    me = await c.get<MeResponse>('/me');
    expect(me.body.user).toMatchObject({ wallet: null, canUnlinkWallet: false });
    // Replaying the request changes nothing and still succeeds.
    expect((await c.post('/auth/wallet/unlink', {})).status).toBe(200);
    // The freed wallet can sign in again (as a new account) or be linked elsewhere.
    expect(await t.ctx.db.user.count({ where: { wallet: w.address } })).toBe(0);

    // Wallet-only account → refused (it would lock the player out).
    const w2 = solanaWallet();
    const v = await visitor(t);
    const n2 = await v.post<WalletNonceResponse>('/auth/wallet/nonce', { address: w2.address });
    expect((await v.post('/auth/wallet/verify', { address: w2.address, signature: w2.sign(n2.body.message), adult: true })).status).toBe(200);
    expect((await v.get<MeResponse>('/me')).body.user.canUnlinkWallet).toBe(false);
    expect(errCode(await v.post('/auth/wallet/unlink', {}))).toBe('conflict');
    expect(await t.ctx.db.user.count({ where: { wallet: w2.address } })).toBe(1);

    // Unauthorised: no account → 401; guest → 403.
    expect((await (await visitor(t)).post('/auth/wallet/unlink', {})).status).toBe(401);
    expect(errCode(await (await guest(t)).post('/auth/wallet/unlink', {}))).toBe('guest_not_allowed');
  });
});

describe('google', () => {
  async function flow(c: Client, state?: string): Promise<{ location: string }> {
    const start = await c.get('/auth/google');
    expect(start.status).toBe(302);
    const loc = new URL(String(start.headers.location));
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/google/callback');
    const cb = await c.get(`/auth/google/callback?code=abc&state=${state ?? loc.searchParams.get('state')}`);
    expect(cb.status).toBe(302);
    return { location: String(cb.headers.location) };
  }

  test('signs in with stubbed Google; the account must confirm 18+ before anything but practice', async () => {
    const c = new Client(t);
    const r = await flow(c);
    expect(r.location).toBe('http://localhost:3000/');
    await c.start();
    const me = await c.me();
    expect(me.user).toMatchObject({ guest: false, adult: false });
    expect(errCode(await c.post('/runs', { game: 'duck', mode: 'ranked' }))).toBe('not_adult');
    expect((await c.post('/runs', { game: 'duck', mode: 'practice' })).status).toBe(200);
    expect((await c.post('/auth/adult', { adult: false })).status).toBe(400);
    expect((await c.post<AuthResponse>('/auth/adult', { adult: true })).body.adult).toBe(true);
    expect((await c.post('/runs', { game: 'duck', mode: 'ranked' })).status).toBe(200);
    // Coming back signs in to the same account.
    const again = new Client(t);
    await flow(again);
    expect((await again.me()).user.id).toBe(me.user.id);
  });

  test('a bad state or a failed exchange signs nobody in', async () => {
    const c = new Client(t);
    expect((await flow(c, 'forged')).location).toContain('auth_error=state');
    expect((await c.get('/me')).status).toBe(401);
    google.fail = true;
    expect((await flow(new Client(t))).location).toContain('auth_error=google');
    google.fail = false;
    // The state is bound to the browser that started the flow.
    const a = new Client(t);
    const start = await a.get('/auth/google');
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const b = await visitor(t);
    const cb = await b.get(`/auth/google/callback?code=abc&state=${state}`);
    expect(String(cb.headers.location)).toContain('auth_error=state');
  });

  test('a verified Google address joins the account that used the same email', async () => {
    const mail = await signUp(t, { email: 'both@example.com', name: 'BothWays' });
    google.sub = 'google-sub-2';
    google.email = 'both@example.com';
    const c = new Client(t);
    await flow(c);
    expect((await c.me()).user.id).toBe(mail.id);
  });
});

describe('adult and logout', () => {
  test('need a session; logout ends it', async () => {
    const v = await visitor(t);
    expect((await v.post('/auth/adult', { adult: true })).status).toBe(401);
    const g = await guest(t);
    expect(errCode(await g.post('/auth/adult', { adult: true }))).toBe('guest_not_allowed');
    const c = await signUp(t);
    expect((await c.get<MeResponse>('/me')).status).toBe(200);
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
  });
});

describe('rate limits', () => {
  test('sign-in codes are limited per email and answer 429', async () => {
    const strict = await makeApp({ config: { rateScale: 1 } });
    try {
      const old = await t.ctx.redis.keys('rl:*');
      if (old.length) await t.ctx.redis.del(...old);
      const c = await visitor(strict);
      const seen: number[] = [];
      for (let i = 0; i < 6; i++) seen.push((await c.post('/auth/email/request', { email: 'flood@example.com' })).status);
      expect(seen).toEqual([200, 200, 200, 200, 200, 429]);
      const last = await c.post('/auth/email/request', { email: 'flood@example.com' });
      expect(errCode(last)).toBe('rate_limited');
      expect(last.headers['retry-after']).toBeDefined();
    } finally {
      await strict.close();
    }
  });
});

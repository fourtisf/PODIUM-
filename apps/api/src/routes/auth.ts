// Sign-in flows: guest, email one-time code, Google OAuth, wallet signature (identity only), logout,
// and the 18+ confirmation. No payment, token or transaction code lives here or anywhere else.
import { randomInt } from 'node:crypto';
import { BRAND, type AuthResponse, type CsrfResponse, type OkResponse, type WalletNonceResponse } from '@podium/shared';
import type { User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bs58 from 'bs58';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { z } from 'zod';
import { AUTH } from '../config';
import { AppError, invalid } from '../errors';
import { csrfFor } from '../plugins/csrf';
import { rateLimit } from '../plugins/ratelimit';
import { endSession, requireUser, startSession } from '../plugins/session';
import { sendCode } from '../services/mailer';
import { createGuest, signIn, type Identity, type SignInOpts } from '../services/users';
import { hmac, safeEqual, token } from '../util';
import { parse } from './_util';

const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().min(1).max(40).optional();
const ref = z.string().trim().min(4).max(16).optional();
/** Decodes base58 to exactly `len` bytes, or null. */
function b58(v: string, len: number): Buffer | null {
  try {
    const b = Buffer.from(bs58.decode(v));
    return b.length === len ? b : null;
  } catch {
    return null;
  }
}
// A Solana address is a base58 ed25519 public key (32 bytes). It is case-sensitive.
const address = z.string().min(32).max(44).refine((a) => b58(a, 32) !== null, 'not a Solana wallet address');
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** True when `signature` (base58, 64 bytes) is the wallet's ed25519 signature of `message`. Identity only. */
export function verifySolanaSignature(addr: string, message: string, signature: string): boolean {
  const key = b58(addr, 32), sig = b58(signature, 64);
  if (!key || !sig) return false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([ED25519_SPKI, key]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(message, 'utf8'), pub, sig);
  } catch {
    return false;
  }
}

const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
} as const;

/** The text a wallet signs to prove it owns an address. Exported so tests sign the same thing. */
export const walletMessage = (addr: string, nonce: string): string =>
  `${BRAND.name} sign-in\n\nSign this message to prove you own this wallet. This does not send a transaction and costs nothing.\n\nAddress: ${addr}\nNonce: ${nonce}`;

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const origin = (req: FastifyRequest): SignInOpts['origin'] => ({ deviceHash: req.deviceHash, ip: req.ip });

  /** Signs the session in as `user` (rotating the session id) and builds the common answer. */
  async function answer(req: FastifyRequest, reply: FastifyReply, user: User, created: boolean, rotate = false): Promise<AuthResponse> {
    const sid = !rotate && req.user?.id === user.id && req.sid ? req.sid : await startSession(ctx, req, reply, user.id);
    return { ok: true, userId: user.id, name: user.name, guest: user.guest, adult: user.adult, created, csrf: csrfFor(ctx, sid) };
  }

  async function signInWith(req: FastifyRequest, reply: FastifyReply, id: Identity, o: Omit<SignInOpts, 'current' | 'origin'>): Promise<AuthResponse> {
    // Creating accounts is limited per device; signing in to an existing one is not.
    if (!req.user || req.user.guest) await rateLimit(ctx, 'signupsPerDevice', req.deviceHash);
    const { user, created } = await signIn(ctx, id, { ...o, current: req.user, origin: origin(req) });
    return answer(req, reply, user, created, true);
  }

  // The CSRF token is bound to the session, so a visitor without one gets an anonymous session here.
  app.get('/auth/csrf', async (req, reply): Promise<CsrfResponse> => {
    const sid = req.sid ?? (await startSession(ctx, req, reply, null));
    return { csrf: csrfFor(ctx, sid) };
  });

  app.post('/auth/guest', async (req, reply): Promise<AuthResponse> => {
    if (req.user) return answer(req, reply, req.user, false); // idempotent: the session already has an account
    await rateLimit(ctx, 'guestsPerIp', req.ip);
    const user = await createGuest(ctx, origin(req));
    return answer(req, reply, user, true);
  });

  // ---------------------------------------------------------------- email one-time code
  const codeKey = (e: string): string => 'emailcode:' + e;

  app.post('/auth/email/request', async (req): Promise<OkResponse> => {
    const body = parse(z.object({ email }), req.body);
    await rateLimit(ctx, 'authPerIp', req.ip);
    await rateLimit(ctx, 'emailCodesPerEmail', body.email);
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    await ctx.redis.set(codeKey(body.email), JSON.stringify({ mac: hmac(ctx.cfg.sessionSecret, `code:${body.email}:${code}`), tries: 0 }), 'EX', AUTH.codeTtlSeconds);
    await sendCode(ctx, body.email, code);
    return { ok: true };
  });

  app.post('/auth/email/verify', async (req, reply): Promise<AuthResponse> => {
    const body = parse(z.object({ email, code: z.string().regex(/^\d{6}$/), adult: z.boolean().optional(), name, ref }), req.body);
    await rateLimit(ctx, 'authPerIp', req.ip);
    const raw = await ctx.redis.get(codeKey(body.email));
    const wrong = new AppError(400, 'invalid', 'That code is wrong or has expired.');
    if (!raw) throw wrong;
    const rec = JSON.parse(raw) as { mac: string; tries: number };
    if (!safeEqual(rec.mac, hmac(ctx.cfg.sessionSecret, `code:${body.email}:${body.code}`))) {
      // Five wrong guesses burn the code.
      if (rec.tries + 1 >= AUTH.codeMaxAttempts) await ctx.redis.del(codeKey(body.email));
      else await ctx.redis.set(codeKey(body.email), JSON.stringify({ ...rec, tries: rec.tries + 1 }), 'KEEPTTL');
      throw wrong;
    }
    // The code is spent only once sign-in succeeds, so a missing age tick or a taken name can be corrected.
    const res = await signInWith(req, reply, { email: body.email }, { adult: body.adult === true, requireAdult: true, name: body.name, ref: body.ref });
    await ctx.redis.del(codeKey(body.email));
    ctx.devCodes.delete(body.email);
    return res;
  });

  // ---------------------------------------------------------------- Google
  const redirectUri = `${ctx.cfg.publicUrl}/api/auth/google/callback`;

  app.get('/auth/google', async (req, reply) => {
    if (!ctx.cfg.googleClientId || !ctx.cfg.googleClientSecret) throw new AppError(503, 'unavailable', 'Google sign-in is not configured.');
    await rateLimit(ctx, 'authPerIp', req.ip);
    const q = parse(z.object({ ref }), req.query);
    // The state is bound to this browser's session so the callback cannot be replayed elsewhere.
    const sid = req.sid ?? (await startSession(ctx, req, reply, null));
    const state = token(24);
    await ctx.redis.set('gstate:' + state, JSON.stringify({ sid, ref: q.ref ?? null }), 'EX', AUTH.oauthStateTtlSeconds);
    const url = new URL(GOOGLE.auth);
    url.search = new URLSearchParams({ client_id: ctx.cfg.googleClientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }).toString();
    return reply.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const fail = (why: string): FastifyReply => reply.redirect(`${ctx.cfg.publicUrl}/?auth_error=${why}`);
    const q = z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(128) }).safeParse(req.query);
    if (!q.success) return fail('google');
    await rateLimit(ctx, 'authPerIp', req.ip);
    const saved = await ctx.redis.getdel('gstate:' + q.data.state);
    const st = saved ? (JSON.parse(saved) as { sid: string; ref: string | null }) : null;
    if (!st || st.sid !== req.sid) return fail('state');
    let profile: { sub?: unknown; email?: unknown; email_verified?: unknown };
    try {
      const tok = await ctx.http(GOOGLE.token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: q.data.code, client_id: ctx.cfg.googleClientId, client_secret: ctx.cfg.googleClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
      });
      const tj = (await tok.json()) as { access_token?: unknown };
      if (!tok.ok || typeof tj.access_token !== 'string') return fail('google');
      const info = await ctx.http(GOOGLE.userinfo, { headers: { authorization: `Bearer ${tj.access_token}` } });
      if (!info.ok) return fail('google');
      profile = (await info.json()) as typeof profile;
    } catch (e) {
      ctx.log.warn(e, 'google sign-in failed');
      return fail('google');
    }
    if (typeof profile.sub !== 'string' || !profile.sub) return fail('google');
    const verified = profile.email_verified === true || profile.email_verified === 'true';
    const mail = verified && typeof profile.email === 'string' ? email.safeParse(profile.email) : null;
    try {
      // A redirect cannot carry the age tick: a new account starts with adult=false and the site
      // asks for POST /auth/adult before anything but practice.
      await signInWith(req, reply, { googleId: profile.sub, ...(mail?.success ? { email: mail.data } : {}) }, { adult: false, requireAdult: false, ref: st.ref ?? undefined });
    } catch (e) {
      ctx.log.warn(e, 'google sign-in failed');
      return fail(e instanceof AppError ? e.code : 'google');
    }
    return reply.redirect(`${ctx.cfg.publicUrl}/`);
  });

  // ---------------------------------------------------------------- wallet (identity only)
  const nonceKey = (a: string): string => 'wnonce:' + a;

  app.post('/auth/wallet/nonce', async (req): Promise<WalletNonceResponse> => {
    const body = parse(z.object({ address }), req.body);
    await rateLimit(ctx, 'authPerIp', req.ip);
    const nonce = token(16);
    await ctx.redis.set(nonceKey(body.address), nonce, 'EX', AUTH.nonceTtlSeconds);
    return { message: walletMessage(body.address, nonce), nonce };
  });

  app.post('/auth/wallet/verify', async (req, reply): Promise<AuthResponse> => {
    const body = parse(z.object({ address, signature: z.string().min(64).max(100), adult: z.boolean().optional(), name, ref }), req.body);
    await rateLimit(ctx, 'authPerIp', req.ip);
    const nonce = await ctx.redis.get(nonceKey(body.address));
    if (!nonce) throw invalid('Ask for a new message to sign.');
    const addr = body.address;
    const ok = verifySolanaSignature(addr, walletMessage(addr, nonce), body.signature);
    if (!ok) throw invalid('That signature does not match the wallet.');
    const res = await signInWith(req, reply, { wallet: addr }, { adult: body.adult === true, requireAdult: true, name: body.name, ref: body.ref });
    await ctx.redis.del(nonceKey(body.address));
    return res;
  });

  // ---------------------------------------------------------------- age gate and logout
  app.post('/auth/adult', async (req, reply): Promise<AuthResponse> => {
    const user = requireUser(req);
    parse(z.object({ adult: z.literal(true) }), req.body);
    if (user.guest) throw new AppError(403, 'guest_not_allowed', 'Sign in first.');
    const u = await ctx.db.user.update({ where: { id: user.id }, data: { adult: true } });
    return answer(req, reply, u, false);
  });

  app.post('/auth/logout', async (req, reply): Promise<OkResponse> => {
    await endSession(ctx, req, reply);
    return { ok: true };
  });
}

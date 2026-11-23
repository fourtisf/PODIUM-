// Sessions: an opaque random token in an httpOnly SameSite=Lax cookie, stored in Redis with a
// sliding 30-day TTL. A session may be anonymous (no account yet): it then only carries the CSRF token.
import type { User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION } from '../config';
import type { Ctx } from '../ctx';
import { AppError, unauthorized } from '../errors';
import { sha256, token } from '../util';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
  }
  interface FastifyRequest {
    /** Session id from the cookie, when it is a live session. */
    sid: string | null;
    user: User | null;
    /** Hash of the client-generated device id (header x-device). */
    deviceHash: string | null;
  }
}

const ANON = '-';
const key = (sid: string): string => 'sess:' + sid;

function setCookie(ctx: Ctx, reply: FastifyReply, sid: string): void {
  void reply.setCookie(SESSION.cookie, sid, { path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.cfg.env === 'production', maxAge: SESSION.ttlSeconds });
}

/** Starts a fresh session (rotating the id on every sign-in) and returns its id. */
export async function startSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, userId: string | null): Promise<string> {
  if (req.sid) await ctx.redis.del(key(req.sid));
  const sid = token(32);
  await ctx.redis.set(key(sid), userId ?? ANON, 'EX', userId ? SESSION.ttlSeconds : SESSION.anonTtlSeconds);
  setCookie(ctx, reply, sid);
  req.sid = sid;
  return sid;
}

export async function endSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.sid) await ctx.redis.del(key(req.sid));
  void reply.clearCookie(SESSION.cookie, { path: '/' });
  req.sid = null;
  req.user = null;
}

export function registerSessions(app: FastifyInstance): void {
  app.decorateRequest('sid', null);
  app.decorateRequest('user', null);
  app.decorateRequest('deviceHash', null);
  app.addHook('onRequest', async (req, reply) => {
    const ctx = app.ctx;
    const dev = req.headers['x-device'];
    if (typeof dev === 'string' && dev.length >= 8 && dev.length <= 128) req.deviceHash = sha256('device:' + dev);
    const sid = req.cookies[SESSION.cookie];
    if (!sid || sid.length > 128) return;
    const val = await ctx.redis.get(key(sid));
    if (!val) return;
    req.sid = sid;
    if (val === ANON) return;
    req.user = await ctx.db.user.findUnique({ where: { id: val } });
    if (!req.user) return;
    // Sliding expiry, for the Redis record and the cookie alike.
    await ctx.redis.expire(key(sid), SESSION.ttlSeconds);
    setCookie(ctx, reply, sid);
  });
}

/** Any account, guests included. */
export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** A signed-in (non-guest) account that confirmed 18+. Needed for everything except practice. */
export function requirePlayer(req: FastifyRequest): User {
  const u = requireUser(req);
  if (u.guest) throw new AppError(403, 'guest_not_allowed', 'Sign in to do that. Guests can play practice only.');
  if (!u.adult) throw new AppError(403, 'not_adult', 'Confirm you are 18 or over first.');
  return u;
}

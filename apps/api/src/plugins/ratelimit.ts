// Fixed-window rate limits in Redis. Keys: rl:<name>:<subject>:<window number>.
import type { FastifyInstance } from 'fastify';
import { RATE } from '../config';
import type { Ctx } from '../ctx';
import { AppError } from '../errors';
import { sha256 } from '../util';

export type RateName = keyof typeof RATE;

/** Counts one hit and throws 429 rate_limited when the subject is over the limit. */
export async function rateLimit(ctx: Ctx, name: RateName, subject: string | null | undefined): Promise<void> {
  if (!subject) return;
  const [max, windowS] = RATE[name];
  const now = Math.floor(+ctx.clock.now() / 1000);
  const key = `rl:${name}:${sha256(subject).slice(0, 32)}:${Math.floor(now / windowS)}`;
  const n = await ctx.redis.incr(key);
  if (n === 1) await ctx.redis.expire(key, windowS + 1);
  if (n > Math.ceil(max * ctx.cfg.rateScale)) {
    const retryAfter = windowS - (now % windowS);
    throw new AppError(429, 'rate_limited', 'Too many requests. Try again shortly.', { retryAfter });
  }
}

/** Blanket limits: reads per IP; mutations per IP, per signed-in user and per device fingerprint. */
export function registerRateLimits(app: FastifyInstance): void {
  app.addHook('preHandler', async (req) => {
    const ctx = app.ctx;
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      await rateLimit(ctx, 'readsPerIp', req.ip);
      return;
    }
    await rateLimit(ctx, 'mutationPerIp', req.ip);
    await rateLimit(ctx, 'mutationPerUser', req.user?.id);
    await rateLimit(ctx, 'mutationPerDevice', req.deviceHash);
  });
}

// CSRF: a token bound to the session id by HMAC(SESSION_SECRET). Every non-GET request must send it
// in x-csrf-token. Cross-origin mutations are also refused when the browser sends an Origin header.
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../ctx';
import { AppError } from '../errors';
import { hmac, safeEqual } from '../util';

export const csrfFor = (ctx: Ctx, sid: string): string => hmac(ctx.cfg.sessionSecret, 'csrf:' + sid);

export function registerCsrf(app: FastifyInstance): void {
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const ctx = app.ctx;
    const origin = req.headers.origin;
    if (origin && origin !== new URL(ctx.cfg.publicUrl).origin) throw new AppError(403, 'csrf', 'Cross-origin request refused.');
    const sent = req.headers['x-csrf-token'];
    if (!req.sid || typeof sent !== 'string' || !safeEqual(sent, csrfFor(ctx, req.sid))) {
      throw new AppError(403, 'csrf', 'Missing or stale CSRF token. Fetch /api/auth/csrf and retry.');
    }
  });
}

import { isFrameKey, type MeResponse, type RefillResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, forbidden, unauthorized } from '../errors';
import { csrfFor } from '../plugins/csrf';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requireUser } from '../plugins/session';
import { refill } from '../services/rewards';
import { checkName, meView, ownedItems } from '../services/users';
import { parse } from './_util';

export default async function meRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/me', async (req): Promise<MeResponse> => {
    if (!req.user || !req.sid) throw unauthorized();
    return meView(ctx, req.user, csrfFor(ctx, req.sid));
  });

  app.patch('/me', async (req): Promise<MeResponse> => {
    const user = requireUser(req);
    const body = parse(z.object({ name: z.string().max(40).optional(), avatar: z.number().int().min(0).optional(), frame: z.string().max(20).optional() }).strict(), req.body);
    const updated = await ctx.db.$transaction(async (tx) => {
      const data: { name?: string; nameLower?: string; avatar?: number; frame?: string } = {};
      if (body.name !== undefined && body.name !== user.name) {
        if (user.guest) throw new AppError(403, 'guest_not_allowed', 'Sign in to choose a name.');
        data.name = await checkName(tx, body.name, user.id);
        data.nameLower = data.name.toLowerCase();
      }
      const own = await ownedItems(tx, user.id);
      if (body.avatar !== undefined) {
        if (!own.avatars.includes(body.avatar)) throw forbidden('You do not own that avatar.');
        data.avatar = body.avatar;
      }
      if (body.frame !== undefined) {
        if (!isFrameKey(body.frame) || !own.frames.includes(body.frame)) throw forbidden('You do not own that frame.');
        data.frame = body.frame;
      }
      return tx.user.update({ where: { id: user.id }, data });
    });
    return meView(ctx, updated, csrfFor(ctx, req.sid!));
  });

  // Refill: back to ECONOMY.refillTo once the balance is under ECONOMY.refillUnder. Guests may refill too (they pay for practice).
  app.post('/refill', async (req, reply) => {
    const user = requireUser(req);
    return idempotent<RefillResponse>(ctx, reply, user.id, 'refill', idemKey(req), async (tx) => ({ status: 200, body: await refill(ctx, tx, user.id, idemKey(req)) }));
  });
}

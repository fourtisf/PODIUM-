import type { ChallengeResponse, CreateChallengeResponse, GameKey } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { conflict, notFound } from '../errors';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requirePlayer } from '../plugins/session';
import { shortCode } from '../util';
import { parse } from './_util';

export default async function challengeRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  // A friend challenge is a short server code for one of my accepted runs (the score never travels in the URL).
  app.post('/challenges', async (req, reply) => {
    const user = requirePlayer(req);
    const body = parse(z.object({ runId: z.string().min(1).max(40) }), req.body);
    return idempotent<CreateChallengeResponse>(ctx, reply, user.id, 'challenges.create', idemKey(req), async (tx) => {
      const run = await tx.run.findUnique({ where: { id: body.runId } });
      if (!run || run.userId !== user.id) throw notFound('No such run.');
      if (run.status !== 'finished' || run.score === null) throw conflict('Only a finished, accepted run can be shared.');
      const existing = await tx.challenge.findUnique({ where: { runId: run.id } });
      if (existing) return { status: 200, body: { code: existing.code } };
      let code = shortCode(7);
      while (await tx.challenge.findUnique({ where: { code } })) code = shortCode(7);
      await tx.challenge.create({ data: { code, userId: user.id, game: run.game, score: run.score, runId: run.id, createdAt: ctx.clock.now() } });
      return { status: 200, body: { code } };
    });
  });

  // Public: the page a shared link opens does not need an account.
  app.get('/challenges/:code', async (req): Promise<ChallengeResponse> => {
    const { code } = req.params as { code: string };
    const ch = /^[A-Za-z0-9]{4,12}$/.test(code) ? await ctx.db.challenge.findUnique({ where: { code: code.toUpperCase() } }) : null;
    const owner = ch ? await ctx.db.user.findUnique({ where: { id: ch.userId }, select: { name: true, avatar: true, frame: true } }) : null;
    if (!ch || !owner) throw notFound('No such challenge.');
    return { code: ch.code, game: ch.game as GameKey, score: ch.score, ...owner };
  });
}

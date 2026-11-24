import { isGameKey, type ChallengeResponse, type CreateChallengeResponse, type GameKey, type GhostEntry, type GhostsResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx, Tx } from '../ctx';
import { conflict, notFound } from '../errors';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requirePlayer } from '../plugins/session';
import { topRows } from '../services/boards';
import { weeklyPeriod } from '../services/periods';
import { isUniqueViolation, shortCode } from '../util';
import { parse } from './_util';

/** How many ghosts GET /ghosts/:game offers. */
const GHOSTS = 5;

/** A fresh, unused challenge code. */
async function newCode(db: Tx): Promise<string> {
  let code = shortCode(7);
  while (await db.challenge.findUnique({ where: { code } })) code = shortCode(7);
  return code;
}

/**
 * The challenge code of an accepted run, creating the Challenge row the first time. Safe under
 * concurrency: one challenge per run (unique runId), and a lost race reads the winner's row.
 */
async function challengeFor(ctx: Ctx, run: { id: string; userId: string; game: string; score: number }): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await ctx.db.challenge.findUnique({ where: { runId: run.id } });
    if (existing) return existing.code;
    try {
      await ctx.db.challenge.create({ data: { code: await newCode(ctx.db), userId: run.userId, game: run.game, score: run.score, runId: run.id, createdAt: ctx.clock.now() } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  const row = await ctx.db.challenge.findUnique({ where: { runId: run.id } });
  if (!row) throw new Error('could not create a challenge for run ' + run.id);
  return row.code;
}

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
      const code = await newCode(tx);
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

  // Public: ghosts are real players' accepted runs from this week's board (best run per player),
  // offered as free challenges when nobody is around. Never generated: an empty board has none.
  app.get('/ghosts/:game', async (req): Promise<GhostsResponse> => {
    const { game } = req.params as { game: string };
    if (!isGameKey(game)) throw notFound('No such game.');
    const period = await weeklyPeriod(ctx.db, game, ctx.clock.now(), ctx);
    const me = req.user?.id ?? null;
    const top = (await topRows(ctx, period, GHOSTS + 1)).map((r, i) => ({ ...r, place: i + 1 })).filter((r) => r.userId !== me).slice(0, GHOSTS);
    const scores = top.length ? await ctx.db.score.findMany({ where: { periodId: period.id, userId: { in: top.map((r) => r.userId) } }, select: { userId: true, runId: true } }) : [];
    const runIds = new Map(scores.map((s) => [s.userId, s.runId]));
    const runs = await ctx.db.run.findMany({ where: { id: { in: [...runIds.values()] }, status: 'finished' }, select: { id: true, userId: true, game: true, score: true } });
    const byId = new Map(runs.map((r) => [r.id, r]));
    const ghosts: GhostEntry[] = [];
    for (const r of top) {
      const run = byId.get(runIds.get(r.userId) ?? '');
      if (!run || run.score === null || run.score !== r.score) continue;
      const code = await challengeFor(ctx, { id: run.id, userId: run.userId, game: run.game, score: run.score });
      ghosts.push({ code, name: r.name, avatar: r.avatar, frame: r.frame, score: r.score, place: r.place });
    }
    return { game, ghosts };
  });
}

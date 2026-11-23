import { GAME_KEYS, type ApiError, type FinishRunResponse, type StartRunRequest, type StartRunResponse, type StreamReply } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '../config';
import { conflict, notFound } from '../errors';
import { idemKey, idempotent, sendOutcome } from '../plugins/idempotency';
import { requirePlayer, requireUser } from '../plugins/session';
import { isAlreadySettled, prepareFinish, settleRun, startRun, storedResult } from '../services/runs';
import { parse } from './_util';

const startSchema = z.object({
  game: z.enum(GAME_KEYS as [string, ...string[]]),
  mode: z.enum(['ranked', 'practice', 'cup', 'duel', 'challenge']),
  duelId: z.string().min(1).max(40).optional(),
  challengeCode: z.string().min(4).max(12).optional(),
});
// The log's structure is checked by validateLog; a bad log rejects the run rather than the request.
const finishSchema = z.object({ score: z.number().int().min(0).max(2 ** 31 - 1), frames: z.number().int().min(0).max(2 ** 31 - 1), inputLog: z.array(z.number()) });

export default async function runRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post('/runs', async (req, reply) => {
    const body = parse(startSchema, req.body) as StartRunRequest;
    // Guests can play practice only; everything else needs a signed-in account that confirmed 18+.
    const user = body.mode === 'practice' ? requireUser(req) : requirePlayer(req);
    return idempotent<StartRunResponse>(ctx, reply, user.id, 'runs.start', idemKey(req), (tx) => startRun(ctx, tx, user, body));
  });

  app.post('/runs/:id/finish', { bodyLimit: LIMITS.finishBodyBytes }, async (req, reply) => {
    const user = requireUser(req);
    const key = idemKey(req);
    const { id } = req.params as { id: string };
    const body = parse(finishSchema, req.body);
    const run = await ctx.db.run.findUnique({ where: { id } });
    if (!run || run.userId !== user.id) throw notFound('No such run.');
    const already = async (): Promise<void> => {
      // A run is settled exactly once; any later finish gets the first answer back.
      const stored = await storedResult(ctx, id);
      if (!stored) throw conflict('That run is already closed.');
      sendOutcome(reply, { ...stored, replayed: true });
    };
    if (run.status !== 'open') return already();
    const { input, verdict, streamedTo } = await prepareFinish(ctx, run, body);
    try {
      return await idempotent<FinishRunResponse | ApiError>(ctx, reply, user.id, `runs.finish:${id}`, key, (tx) => settleRun(ctx, tx, id, input, verdict, streamedTo));
    } catch (e) {
      if (isAlreadySettled(e)) return already();
      throw e;
    }
  });

  // Phase 2 live input stream. Authenticated by the run's streamToken, so no cookie is needed on the socket.
  app.get('/runs/:id/stream', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const { token } = req.query as { token?: string };
    const send = (m: StreamReply): void => socket.send(JSON.stringify(m));
    if (typeof token !== 'string' || !ctx.stream.checkToken(id, token)) {
      send({ ended: true, reason: 'bad stream token' });
      socket.close(4401, 'unauthorized');
      return;
    }
    // Messages are handled strictly in order.
    let chain: Promise<void> = Promise.resolve();
    socket.on('message', (data: Buffer) => {
      chain = chain.then(async () => {
        let msg: unknown = null;
        try {
          msg = JSON.parse(data.toString('utf8'));
        } catch {
          /* handled as a malformed message */
        }
        try {
          const res = await ctx.stream.onMessage(id, msg);
          send(res);
          if ('ended' in res) socket.close(4000, 'ended');
        } catch (e) {
          ctx.log.error(e, 'stream message failed');
        }
      });
    });
    socket.on('error', () => socket.close());
  });
}

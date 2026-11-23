import { GAME_KEYS, isDuelStake, type CreateDuelResponse, type DuelsResponse, type GameKey } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireValue } from '../chain/geo';
import { invalid } from '../errors';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requirePlayer } from '../plugins/session';
import { createOrJoinDuel, duelsView } from '../services/duels';
import { parse } from './_util';

export default async function duelRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post('/duels', async (req, reply) => {
    const user = requirePlayer(req);
    requireValue(ctx, req, user);
    const body = parse(z.object({ game: z.enum(GAME_KEYS as [string, ...string[]]), stake: z.number().int() }), req.body);
    if (!isDuelStake(body.stake)) throw invalid('That stake is not offered.');
    return idempotent<CreateDuelResponse>(ctx, reply, user.id, 'duels.create', idemKey(req), async (tx) => ({
      status: 200,
      body: await createOrJoinDuel(ctx, tx, user, body.game as GameKey, body.stake),
    }));
  });

  app.get('/duels', async (req): Promise<DuelsResponse> => duelsView(ctx, requirePlayer(req)));
}

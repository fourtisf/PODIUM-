// Missions, streak, season, boxes and shop. All of them need a signed-in 18+ account and an Idempotency-Key.
import type { BoxOpenResponse, MissionClaimResponse, SeasonClaimResponse, ShopBuyRequest, ShopBuyResponse, ShopResponse, StreakClaimResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requirePlayer } from '../plugins/session';
import { claimMission, claimSeason, claimStreak, openBox, shopBuy, shopView } from '../services/rewards';
import { parse } from './_util';

export default async function rewardRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post('/missions/:id/claim', async (req, reply) => {
    const user = requirePlayer(req);
    const { id } = parse(z.object({ id: z.string().min(1).max(12) }), req.params);
    return idempotent<MissionClaimResponse>(ctx, reply, user.id, `missions.claim:${id}`, idemKey(req), async (tx) => ({ status: 200, body: await claimMission(ctx, tx, user.id, id) }));
  });

  app.post('/streak/claim', async (req, reply) => {
    const user = requirePlayer(req);
    return idempotent<StreakClaimResponse>(ctx, reply, user.id, 'streak.claim', idemKey(req), async (tx) => ({ status: 200, body: await claimStreak(ctx, tx, user.id) }));
  });

  app.post('/season/:tier/claim', async (req, reply) => {
    const user = requirePlayer(req);
    const { tier } = parse(z.object({ tier: z.coerce.number().int().min(0).max(999) }), req.params);
    return idempotent<SeasonClaimResponse>(ctx, reply, user.id, `season.claim:${tier}`, idemKey(req), async (tx) => ({ status: 200, body: await claimSeason(ctx, tx, user.id, tier) }));
  });

  app.post('/boxes/open', async (req, reply) => {
    const user = requirePlayer(req);
    const key = idemKey(req);
    return idempotent<BoxOpenResponse>(ctx, reply, user.id, 'boxes.open', key, async (tx) => ({ status: 200, body: await openBox(ctx, tx, user.id, key) }));
  });

  app.post('/shop/buy', async (req, reply) => {
    const user = requirePlayer(req);
    const key = idemKey(req);
    const body = parse(z.object({ kind: z.enum(['box', 'avatar', 'frame']), id: z.union([z.number().int(), z.string().max(20)]).optional() }), req.body) as ShopBuyRequest;
    return idempotent<ShopBuyResponse>(ctx, reply, user.id, 'shop.buy', key, async (tx) => ({ status: 200, body: await shopBuy(ctx, tx, user.id, body, key) }));
  });

  app.get('/shop', async (req): Promise<ShopResponse> => shopView(ctx, req.user?.id ?? null));
}

import { ECONOMY, FEATURED_ORDER, isGameKey, type ActivityResponse, type CupResponse, type GameCard, type GameKey, type GamesResponse, type LeaderboardResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { LIMITS } from '../config';
import { notFound } from '../errors';
import { GAMES_CACHE, boardView, topRows } from '../services/boards';
import { allWeeklyPeriods, cupPeriod, weeklyPeriod } from '../services/periods';

type PublicCard = Omit<GameCard, 'myBest'> & { periodId: string };

export default async function gameRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  /** Pools, top three and play counts are the same for everyone, so they are cached for a few seconds. */
  async function publicCards(now: Date): Promise<PublicCard[]> {
    const cached = await ctx.redis.get(GAMES_CACHE);
    if (cached) {
      const cards = JSON.parse(cached) as PublicCard[];
      if (cards[0] && +new Date(cards[0].endsAt) > +now) return cards;
    }
    const periods = await allWeeklyPeriods(ctx.db, now, ctx);
    const plays = await ctx.db.run.groupBy({ by: ['periodId'], where: { periodId: { in: periods.map((p) => p.id) } }, _count: { _all: true } });
    const count = new Map(plays.map((p) => [p.periodId, p._count._all]));
    const cards: PublicCard[] = [];
    for (const p of periods) {
      const top = await topRows(ctx, p, 3);
      cards.push({
        key: p.game as GameKey, periodId: p.id, pool: p.pool, endsAt: p.endAt.toISOString(), plays: count.get(p.id) ?? 0,
        top3: top.map((r) => ({ name: r.name, avatar: r.avatar, frame: r.frame, score: r.score })),
      });
    }
    await ctx.redis.set(GAMES_CACHE, JSON.stringify(cards), 'EX', LIMITS.gamesCacheSeconds);
    return cards;
  }

  app.get('/games', async (req): Promise<GamesResponse> => {
    const now = ctx.clock.now();
    const cards = await publicCards(now);
    const mine = req.user ? await ctx.db.score.findMany({ where: { userId: req.user.id, periodId: { in: cards.map((c) => c.periodId) } }, select: { periodId: true, score: true } }) : [];
    const best = new Map(mine.map((s) => [s.periodId, s.score]));
    const pool = new Map(cards.map((c) => [c.key, c.pool]));
    // Hero: the featured game with the largest pool; FEATURED_ORDER breaks ties (and decides while all pools are empty).
    const hero = FEATURED_ORDER.reduce((a, k) => ((pool.get(k) ?? 0) > (pool.get(a) ?? 0) ? k : a), FEATURED_ORDER[0]!);
    return {
      games: cards.map(({ periodId, ...c }) => ({ ...c, myBest: best.get(periodId) ?? null })),
      hero,
      serverTime: now.toISOString(),
    };
  });

  app.get('/leaderboard/:game', async (req): Promise<LeaderboardResponse> => {
    const { game } = req.params as { game: string };
    if (!isGameKey(game)) throw notFound('No such game.');
    const period = await weeklyPeriod(ctx.db, game, ctx.clock.now(), ctx);
    return boardView(ctx, period, req.user?.id ?? null);
  });

  app.get('/cup', async (req): Promise<CupResponse> => {
    const period = await cupPeriod(ctx.db, ctx.clock.now(), ctx);
    return { ...(await boardView(ctx, period, req.user?.id ?? null)), entry: ECONOMY.cupEntry };
  });

  app.get('/activity', async (): Promise<ActivityResponse> => {
    const rows = await ctx.db.activity.findMany({ orderBy: { createdAt: 'desc' }, take: LIMITS.activityRows });
    return { items: rows.map((r) => ({ name: r.name, text: r.text, game: r.game, at: r.createdAt.toISOString() })) };
  });
}

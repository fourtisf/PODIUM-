// Leaderboards. Postgres (Score) is the source of truth; a Redis sorted set per period is the fast
// path for "top N" and "my place", rebuilt from Postgres whenever it is missing or has expired.
import { CUP_WINNERS, ECONOMY, WEEKLY_WINNERS, projectedPrize, type BoardResponse, type BoardRow, type GameKey } from '@podium/shared';
import type { Period } from '@prisma/client';
import { LIMITS } from '../config';
import type { Ctx, Tx } from '../ctx';

const TIE_BITS = 2 ** 26; // 10 ms slots over a week fit in 26 bits
const zkey = (periodId: string): string => 'lb:' + periodId;

/** Sorted-set score: the game score, with earlier `setAt` ranking higher among equal scores. */
function zscore(score: number, setAt: Date, startAt: Date): number {
  const slot = Math.max(0, Math.min(TIE_BITS - 1, Math.floor((+setAt - +startAt) / 10)));
  return score * TIE_BITS + (TIE_BITS - 1 - slot);
}

export const splitFor = (kind: string): readonly number[] => (kind === 'cup' ? ECONOMY.cupSplit : ECONOMY.weeklySplit);
export const winnersFor = (kind: string): number => (kind === 'cup' ? CUP_WINNERS : WEEKLY_WINNERS);

/** 1-based place of a (score, setAt) pair on a period's board, straight from Postgres. */
export async function placeOf(db: Tx, periodId: string, score: number, setAt: Date): Promise<number> {
  const ahead = await db.score.count({ where: { periodId, OR: [{ score: { gt: score } }, { score, setAt: { lt: setAt } }] } });
  return ahead + 1;
}

async function ensureZset(ctx: Ctx, period: Period): Promise<void> {
  const key = zkey(period.id);
  if (await ctx.redis.exists(key)) return;
  const rows = await ctx.db.score.findMany({ where: { periodId: period.id }, select: { userId: true, score: true, setAt: true } });
  if (!rows.length) return;
  const pipe = ctx.redis.multi().del(key);
  for (const r of rows) pipe.zadd(key, zscore(r.score, r.setAt, period.startAt), r.userId);
  await pipe.expire(key, LIMITS.boardCacheSeconds).exec();
}

/** Call after the transaction that changed a score has committed. */
export async function boardChanged(ctx: Ctx, period: Period, userId: string, score: number, setAt: Date): Promise<void> {
  const key = zkey(period.id);
  // Only patch a set that exists; a missing one is rebuilt from Postgres on the next read.
  if (await ctx.redis.exists(key)) await ctx.redis.zadd(key, zscore(score, setAt, period.startAt), userId);
  await ctx.redis.del(GAMES_CACHE);
}

export const GAMES_CACHE = 'cache:games';

export interface RankedRow {
  userId: string;
  score: number;
  setAt: Date;
  name: string;
  avatar: number;
  frame: string;
}

/** Top rows of a board, exact order (score, then earlier setAt). */
export async function topRows(ctx: Ctx, period: Period, limit: number): Promise<RankedRow[]> {
  await ensureZset(ctx, period);
  const ids = await ctx.redis.zrevrange(zkey(period.id), 0, limit - 1);
  const select = { userId: true, score: true, setAt: true, user: { select: { name: true, avatar: true, frame: true } } } as const;
  let rows = ids.length ? await ctx.db.score.findMany({ where: { periodId: period.id, userId: { in: ids } }, select }) : [];
  if (rows.length !== ids.length || !ids.length) {
    // The set is stale or empty: read the truth and drop the set so it is rebuilt.
    rows = await ctx.db.score.findMany({ where: { periodId: period.id }, orderBy: [{ score: 'desc' }, { setAt: 'asc' }], take: limit, select });
    if (ids.length) await ctx.redis.del(zkey(period.id));
  }
  return rows
    .sort((a, b) => b.score - a.score || +a.setAt - +b.setAt)
    .map((r) => ({ userId: r.userId, score: r.score, setAt: r.setAt, name: r.user.name, avatar: r.user.avatar, frame: r.user.frame }));
}

async function myPlace(ctx: Ctx, period: Period, userId: string): Promise<{ place: number; score: number } | null> {
  const mine = await ctx.db.score.findUnique({ where: { periodId_userId: { periodId: period.id, userId } } });
  if (!mine) return null;
  const rank = await ctx.redis.zrevrank(zkey(period.id), userId);
  const place = rank === null ? await placeOf(ctx.db, period.id, mine.score, mine.setAt) : rank + 1;
  return { place, score: mine.score };
}

export async function boardView(ctx: Ctx, period: Period, userId: string | null): Promise<BoardResponse> {
  const split = splitFor(period.kind);
  const top = await topRows(ctx, period, LIMITS.boardRows);
  const rows: BoardRow[] = top.map((r, i) => ({
    place: i + 1,
    userId: r.userId,
    name: r.name,
    avatar: r.avatar,
    frame: r.frame,
    score: r.score,
    prize: projectedPrize(period.pool, split, i + 1),
  }));
  let me = userId ? await myPlace(ctx, period, userId) : null;
  const inTop = userId ? rows.find((r) => r.userId === userId) : undefined;
  if (me && inTop) me = { place: inTop.place, score: inTop.score };
  return {
    game: period.game as GameKey,
    period: { startAt: period.startAt.toISOString(), endAt: period.endAt.toISOString() },
    pool: period.pool,
    fee: Math.round(period.pool * ECONOMY.fee),
    payouts: split.map((_, i) => projectedPrize(period.pool, split, i + 1)),
    rows,
    me,
    beta: true,
  };
}

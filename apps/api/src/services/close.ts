// Weekly close: pays the split of every board and Cup whose period has ended, records the fee and
// opens the next period. Idempotent (closed flag + payout idemKeys) and guarded by a Redis lock.
import { BRAND, GAME_KEYS, WEEKLY_WINNERS, XP, fmt, gameMeta, splitPool, type GameKey } from '@podium/shared';
import { enqueueOp, poolKind, type OpPayloads } from '../chain/outbox';
import { LIMITS, TX } from '../config';
import type { Ctx } from '../ctx';
import { token } from '../util';
import { splitFor } from './boards';
import { addFee, applyLedger } from './ledger';
import { notify } from './notifications';
import { allWeeklyPeriods, cupPeriod, ensureNext } from './periods';

export interface CloseReport {
  /** False when another instance held the lock and nothing was done. */
  ran: boolean;
  closed: { periodId: string; kind: string; game: string; pool: number; fee: number; payouts: { userId: string; place: number; amount: number }[] }[];
}

async function closeOne(ctx: Ctx, periodId: string, now: Date): Promise<CloseReport['closed'][number] | null> {
  return ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Period" WHERE id = ${periodId} FOR UPDATE`;
    const period = await tx.period.findUnique({ where: { id: periodId } });
    if (!period || period.closed || period.endAt > now) return null;
    // Final places for everyone: best score per player, ties to the earlier score.
    await tx.$executeRaw`
      UPDATE "Score" s SET place = r.rn
      FROM (SELECT id, row_number() OVER (ORDER BY score DESC, "setAt" ASC, id ASC) AS rn FROM "Score" WHERE "periodId" = ${periodId}) r
      WHERE s.id = r.id`;
    const split = splitFor(period.kind);
    const winners = await tx.score.findMany({ where: { periodId, place: { lte: split.length } }, orderBy: { place: 'asc' }, include: { user: { select: { name: true, wallet: true } } } });
    const { payouts } = splitPool(period.pool, split, winners.length);
    // With fewer players than paid places the unclaimed shares are not paid to anyone: they go to fees.
    const totalFee = period.pool - payouts.reduce((a, b) => a + b, 0);
    const label = period.kind === 'cup' ? `${BRAND.name} Cup` : gameMeta(period.game as GameKey).name;
    const paid: { userId: string; place: number; amount: number }[] = [];
    for (const [i, w] of winners.entries()) {
      const amount = payouts[i] ?? 0;
      await applyLedger(tx, { userId: w.userId, amount, reason: 'payout', idemKey: `payout:${period.id}:${w.userId}`, ref: period.id, at: now, stat: 'won' });
      await tx.score.update({ where: { id: w.id }, data: { payout: amount } });
      const topThree = period.kind === 'weekly' && i < WEEKLY_WINNERS;
      if (topThree) await tx.user.update({ where: { id: w.userId }, data: { xp: { increment: XP.weeklyTopThree } } });
      await notify(tx, w.userId, 'payout', `You finished place <b>${i + 1}</b> in <b>${label}</b> and won <b>${fmt(amount)} tChips</b>${topThree ? ` and ${XP.weeklyTopThree} XP` : ''}.`, now);
      paid.push({ userId: w.userId, place: i + 1, amount });
    }
    await tx.period.update({ where: { id: period.id }, data: { closed: true, fee: totalFee } });
    if (ctx.chain) {
      // One close_pool pays the same winners the same amounts, in place order; the rest of the pool is the fee.
      const onchain: OpPayloads['closePool']['winners'] = winners.map((w, i) => {
        if (!w.user.wallet) throw new Error(`winner ${w.userId} of period ${period.id} has no wallet`);
        return { wallet: w.user.wallet, chips: payouts[i] ?? 0, userId: w.userId };
      });
      await enqueueOp(ctx, tx, 'closePool', `close:${period.id}`, { kind: poolKind(period.kind), game: period.game, start: Math.floor(+period.startAt / 1000), winners: onchain });
    }
    if (totalFee > 0) await addFee(tx, totalFee, now);
    await ensureNext(tx, period, ctx);
    return { periodId: period.id, kind: period.kind, game: period.game, pool: period.pool, fee: totalFee, payouts: paid };
  }, TX);
}

/** Closes every period that has ended. Running it again changes nothing. */
export async function closeDuePeriods(ctx: Ctx, now: Date = ctx.clock.now()): Promise<CloseReport> {
  const lock = 'lock:close';
  const owner = token(12);
  if ((await ctx.redis.set(lock, owner, 'PX', LIMITS.closeLockMs, 'NX')) !== 'OK') return { ran: false, closed: [] };
  try {
    const due = await ctx.db.period.findMany({ where: { closed: false, endAt: { lte: now } }, orderBy: { endAt: 'asc' }, select: { id: true } });
    const closed: CloseReport['closed'] = [];
    for (const { id } of due) {
      const r = await closeOne(ctx, id, now);
      if (r) {
        closed.push(r);
        await ctx.redis.del('lb:' + id);
      }
    }
    // Make sure this week's boards and Cup exist even when nobody has played yet.
    if ((await allWeeklyPeriods(ctx.db, now, ctx)).length < GAME_KEYS.length) ctx.log.warn({}, 'some weekly periods are missing');
    await cupPeriod(ctx.db, now, ctx);
    if (closed.length) await ctx.redis.del('cache:games');
    return { ran: true, closed };
  } finally {
    // Release only our own lock.
    await ctx.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lock, owner);
  }
}

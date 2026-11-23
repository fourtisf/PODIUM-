// Background jobs of the API process (one instance): weekly close, duel expiry and housekeeping.
import { startChainWorker, syncRewardsPot, withChainLock } from '../chain/outbox';
import { sweepWithdrawals } from '../chain/withdrawals';
import { LIMITS } from '../config';
import type { Ctx } from '../ctx';
import { closeDuePeriods } from './close';
import { expireDuels } from './duels';

const DAY = 86_400_000;

/** Drops old idempotency records and gives up on runs that were started and never finished. */
export async function cleanup(ctx: Ctx, now: Date = ctx.clock.now()): Promise<{ idempotency: number; runs: number }> {
  const idempotency = await ctx.db.idempotency.deleteMany({ where: { createdAt: { lt: new Date(+now - LIMITS.idempotencyKeepDays * DAY) } } });
  const runs = await ctx.db.run.updateMany({
    where: { status: 'open', createdAt: { lt: new Date(+now - LIMITS.staleRunDays * DAY) } },
    data: { status: 'rejected', reason: 'abandoned', finishedAt: now },
  });
  return { idempotency: idempotency.count, runs: runs.count };
}

export async function runJobs(ctx: Ctx): Promise<void> {
  const jobs: [string, () => Promise<unknown>][] = [['close', () => closeDuePeriods(ctx)], ['duels', () => expireDuels(ctx, ctx.clock.now())], ['cleanup', () => cleanup(ctx)]];
  if (ctx.chain) {
    // Chain mode: settle open withdrawals (returning dead reservations) and re-read the rewards pot while the outbox is idle.
    jobs.push(['withdrawals', () => sweepWithdrawals(ctx)], ['rewards pot', () => withChainLock(ctx, () => syncRewardsPot(ctx))]);
  }
  for (const [name, job] of jobs) {
    try {
      await job();
    } catch (e) {
      ctx.log.error(e, `job ${name} failed`);
    }
  }
}

/** Starts the once-a-minute job loop. Returns a function that stops it. */
export function startJobs(ctx: Ctx): () => void {
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await runJobs(ctx);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), LIMITS.jobEveryMs);
  timer.unref();
  void tick();
  const stopChain = startChainWorker(ctx);
  return () => {
    clearInterval(timer);
    stopChain();
  };
}

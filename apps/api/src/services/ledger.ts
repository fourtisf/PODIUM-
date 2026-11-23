// The one place a balance changes. Every change is a Ledger row with a deterministic unique idemKey,
// written in the caller's transaction together with a guarded atomic update of User.balance.
import { EMISSIONS, dayNum, scaleEmission, type EmissionPaid } from '@podium/shared';
import { Prisma } from '@prisma/client';
import { enqueueOp, releaseReward, reserveReward, walletOf } from '../chain/outbox';
import type { Ctx, Tx } from '../ctx';
import { AppError, notEnoughChips } from '../errors';

export type LedgerReason =
  | 'entry' | 'payout' | 'duel' | 'duel_refund' | 'mission' | 'streak' | 'season' | 'box' | 'shop' | 'refill' | 'referral'
  // Phase 3 (devnet test token)
  | 'deposit' | 'withdraw' | 'withdraw_refund';

export interface LedgerEntry {
  userId: string;
  /** Positive in, negative out. */
  amount: number;
  reason: LedgerReason;
  idemKey: string;
  ref?: string;
  at: Date;
  /** Which profile counter the amount also feeds: prizes and rewards count as "won", entries and purchases as "spent". */
  stat?: 'won' | 'spent' | 'unspent';
}

/**
 * Applies one balance change. Returns false when the idemKey was already applied (a no-op) or the
 * amount is zero. Throws not_enough_chips when a charge would take the balance below zero; the
 * caller's transaction then rolls back, ledger row included.
 */
export async function applyLedger(tx: Tx, e: LedgerEntry): Promise<boolean> {
  if (!Number.isInteger(e.amount)) throw new Error('ledger amounts are whole tChips');
  if (e.amount === 0) return false;
  // ON CONFLICT DO NOTHING: a unique hit on idemKey means "already applied" and must not abort the transaction.
  const ins = await tx.ledger.createMany({
    data: [{ userId: e.userId, amount: e.amount, reason: e.reason, ref: e.ref ?? null, idemKey: e.idemKey, createdAt: e.at }],
    skipDuplicates: true,
  });
  if (ins.count === 0) return false;
  const data: Prisma.UserUpdateManyMutationInput = { balance: { increment: e.amount } };
  if (e.stat === 'won') data.won = { increment: e.amount };
  if (e.stat === 'spent') data.spent = { increment: -e.amount };
  if (e.stat === 'unspent') data.spent = { decrement: e.amount };
  const upd = await tx.user.updateMany({
    where: { id: e.userId, ...(e.amount < 0 ? { balance: { gte: -e.amount } } : {}) },
    data,
  });
  if (upd.count === 0) {
    if (e.amount < 0) throw notEnoughChips();
    throw new AppError(404, 'not_found', 'Account not found.');
  }
  return true;
}

/** Locks the player's row for the rest of the transaction so their money-like operations run one at a time. */
export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

// ---------------------------------------------------------------- counters
/** Adds to a running total and returns the new value. The row stays locked until the transaction ends. */
export async function bump(tx: Tx, key: string, by: number): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" (key, value) VALUES (${key}, ${by})
    ON CONFLICT (key) DO UPDATE SET value = "Counter".value + EXCLUDED.value
    RETURNING value`;
  return Number(rows[0]!.value);
}

export async function readCounter(db: Tx, key: string): Promise<number> {
  return (await db.counter.findUnique({ where: { key } }))?.value ?? 0;
}

export const feesKey = (now: Date): string => 'fees:' + dayNum(now);
export const emittedKey = (now: Date): string => 'emitted:' + dayNum(now);
export const BURNED = 'burned';

/** Records a platform fee (pool fees, duel fees, forfeited stakes, unclaimed prize shares). */
export const addFee = (tx: Tx, amount: number, now: Date): Promise<number> => bump(tx, feesKey(now), amount);

// ---------------------------------------------------------------- emissions
/** The day's reward budget: a fixed base plus the fees collected the previous UTC day. */
export async function emissionBudget(db: Tx, now: Date): Promise<number> {
  return EMISSIONS.dailyBase + (await readCounter(db, 'fees:' + (dayNum(now) - 1)));
}

/**
 * Pays a reward (mission, streak, season, box) out of the daily budget. The counter row is locked
 * first, so concurrent claims queue up and can never overspend the budget between them.
 */
export async function emit(ctx: Ctx, tx: Tx, e: Omit<LedgerEntry, 'amount' | 'stat'> & { nominal: number }): Promise<EmissionPaid> {
  const key = emittedKey(e.at);
  const spent = await bump(tx, key, 0); // takes the row lock
  const budget = await emissionBudget(tx, e.at);
  const paid = await payReward(ctx, tx, { ...e, amount: scaleEmission(e.nominal, budget, spent), stat: 'won' });
  if (paid > 0) await bump(tx, key, paid);
  return { chips: paid, nominal: e.nominal, scaled: paid < e.nominal };
}

/**
 * Credits a reward (mission, streak, season, box, referral bonus). In chain mode the amount is
 * also capped by what is left of the on-chain rewards pot (scaled down, possibly to zero) and
 * mirrored on-chain with credit_reward, where it vests. Returns the tChips actually paid.
 */
export async function payReward(ctx: Ctx, tx: Tx, e: LedgerEntry): Promise<number> {
  const wallet = ctx.chain ? await walletOf(tx, e.userId) : null;
  const chips = await reserveReward(ctx, tx, e.amount);
  const applied = await applyLedger(tx, { ...e, amount: chips });
  if (!applied) {
    await releaseReward(ctx, tx, chips);
    return 0;
  }
  if (wallet) await enqueueOp(ctx, tx, 'creditReward', e.idemKey, { wallet, chips }, e.userId);
  return chips;
}

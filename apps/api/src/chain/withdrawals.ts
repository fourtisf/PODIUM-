// Withdrawals of the devnet TEST token, in two idempotent steps.
//   prepare: the amount is debited from the ledger at once (a reservation) and an unsigned
//            withdraw transaction is handed to the player's wallet;
//   submit:  the server checks the signed transaction, co-signs it as the program's operator,
//            sends it and waits for confirmation.
// If the transaction fails, or its blockhash expires without it ever landing, the reservation
// is returned exactly once (ledger idemKey withdraw-refund:<id>).
//
// Rules that keep this safe:
//   * the signed transaction must use the blockhash that was prepared, so lastValidBlockHeight
//     really is the last block it can land in (and it has one instruction, so no durable nonce);
//   * the withdrawal moves prepared -> submitted with one conditional UPDATE that also stores the
//     transaction id, BEFORE the co-signed bytes leave this process; only that claimer co-signs,
//     and a later submit co-signs again only for the very same transaction id;
//   * "never landed" is decided from the FINALIZED block height, read before the signature status.
import { WithdrawCheckError, buildWithdrawTx, findCustomCode, matured } from '@podium/chain';
import type { OpenWithdrawal, WithdrawPrepareResponse, WithdrawSubmitResponse, WithdrawalStatus } from '@podium/shared';
import type { User, Withdrawal } from '@prisma/client';
import { PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { LIMITS } from '../config';
import type { Ctx, Tx } from '../ctx';
import { AppError, conflict, forbidden, invalid, notFound } from '../errors';
import { applyLedger, lockUser } from '../services/ledger';
import { pendingOpsOf, walletRequired } from './outbox';

const OPEN: WithdrawalStatus[] = ['prepared', 'submitted'];
const onHold = (): AppError => forbidden('Withdrawals are on hold while this account is reviewed.');

export const openView = (w: Withdrawal): OpenWithdrawal => ({ id: w.id, amount: w.amount, status: w.status as WithdrawalStatus });

/** Ends an open withdrawal as `to` and returns the reserved tChips, once. False when it was no longer in `from`. */
async function release(ctx: Ctx, tx: Tx, w: Withdrawal, from: WithdrawalStatus, to: 'expired' | 'failed'): Promise<boolean> {
  const moved = await tx.withdrawal.updateMany({ where: { id: w.id, status: from }, data: { status: to } });
  if (moved.count === 0) return false;
  await applyLedger(tx, { userId: w.userId, amount: w.amount, reason: 'withdraw_refund', idemKey: `withdraw-refund:${w.id}`, ref: w.id, at: ctx.clock.now() });
  return true;
}

/**
 * Brings one open withdrawal up to date with the chain: confirmed when its transaction landed,
 * failed / expired (reservation returned) when it failed or can no longer land.
 */
export async function settleWithdrawal(ctx: Ctx, id: string): Promise<Withdrawal | null> {
  const chain = ctx.chain!;
  const w = await ctx.db.withdrawal.findUnique({ where: { id } });
  if (!w || !OPEN.includes(w.status as WithdrawalStatus)) return w;
  // Height first: once the finalized height is past the last valid block, a transaction that
  // did land is already visible to the status call that follows.
  const height = await chain.rpc.finalizedHeight();
  const dead = height > w.lastValidBlockHeight;
  if (w.status === 'prepared') {
    if (dead) await ctx.db.$transaction((tx) => release(ctx, tx, w, 'prepared', 'expired'));
  } else {
    const st = w.signature ? await chain.rpc.signatureStatus(w.signature) : null;
    if (st === 'ok') await ctx.db.withdrawal.updateMany({ where: { id, status: 'submitted' }, data: { status: 'confirmed' } });
    else if (st === 'failed') await ctx.db.$transaction((tx) => release(ctx, tx, w, 'submitted', 'failed'));
    else if (dead) await ctx.db.$transaction((tx) => release(ctx, tx, w, 'submitted', 'expired'));
  }
  return ctx.db.withdrawal.findUnique({ where: { id } });
}

/** Job: settles every open withdrawal (confirms, or returns the reservation of dead ones). */
export async function sweepWithdrawals(ctx: Ctx): Promise<number> {
  if (!ctx.chain) return 0;
  const open = await ctx.db.withdrawal.findMany({ where: { status: { in: OPEN } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 200 });
  let closed = 0;
  for (const { id } of open) {
    try {
      const w = await settleWithdrawal(ctx, id);
      if (w && !OPEN.includes(w.status as WithdrawalStatus)) closed++;
    } catch (e) {
      ctx.log.warn(e, 'withdrawal sweep failed');
    }
  }
  return closed;
}

/** What the wallet could withdraw right now, in whole tChips: matured on-chain balance, capped by the ledger. */
export async function withdrawableNow(ctx: Ctx, wallet: string, dbBalance: number): Promise<{ free: bigint; chips: number; frozen: boolean }> {
  const chain = ctx.chain!;
  const p = await chain.player(wallet);
  if (!p) return { free: 0n, chips: 0, frozen: false };
  const free = matured(p, await chain.rpc.chainTime());
  return { free, chips: Math.max(0, Math.min(chain.toChips(free), dbBalance)), frozen: p.frozen };
}

/** Step 1. Runs inside the idempotency transaction; `before` (token account, blockhash) was done outside it. */
export async function prepareWithdrawal(ctx: Ctx, tx: Tx, userId: string, amount: number, bh: { blockhash: string; lastValidBlockHeight: number }): Promise<WithdrawPrepareResponse> {
  const chain = ctx.chain!;
  await lockUser(tx, userId);
  let u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.wallet) throw walletRequired();
  if (u.flagged || u.chainHold) throw onHold();
  // One open withdrawal at a time. A prepared one was never co-signed, so it cannot land and may
  // be replaced; a submitted one has to finish first.
  for (const w of await tx.withdrawal.findMany({ where: { userId, status: { in: OPEN } } })) {
    if (w.status !== 'prepared' || !(await release(ctx, tx, w, 'prepared', 'expired'))) throw conflict('Your last withdrawal is still being confirmed. Try again in a moment.');
  }
  u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if ((await pendingOpsOf(tx, userId, u.wallet)) > 0) throw conflict('Your last plays are still settling. Try again in a moment.');
  if (u.balance < amount) throw new AppError(402, 'not_enough_chips', 'You do not have that many tChips.');
  const free = await withdrawableNow(ctx, u.wallet!, u.balance);
  if (free.frozen) throw onHold();
  if (free.free < chain.toBase(amount)) {
    throw conflict(`Only ${chain.toChips(free.free)} tChips can be withdrawn right now. Reward tChips can be played at once and withdrawn after the vesting delay.`);
  }
  const w = await tx.withdrawal.create({
    data: { userId, wallet: u.wallet!, amount, status: 'prepared', blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight, createdAt: ctx.clock.now() },
  });
  await applyLedger(tx, { userId, amount: -amount, reason: 'withdraw', idemKey: `withdraw:${w.id}`, ref: w.id, at: ctx.clock.now() });
  const unsigned = buildWithdrawTx({
    wallet: new PublicKey(u.wallet!), mint: chain.mint, amount: chain.toBase(amount), operator: chain.operator.publicKey, recentBlockhash: bh.blockhash, programId: chain.programId,
  });
  return {
    withdrawId: w.id, amount, lastValidBlockHeight: bh.lastValidBlockHeight, balance: u.balance - amount,
    transaction: unsigned.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
  };
}

const view = async (ctx: Ctx, w: Withdrawal): Promise<WithdrawSubmitResponse> => ({
  withdrawId: w.id, status: w.status as WithdrawalStatus, signature: w.signature,
  balance: (await ctx.db.user.findUniqueOrThrow({ where: { id: w.userId }, select: { balance: true } })).balance,
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** How long submit waits for the chain before answering "submitted" (tests shorten it). */
export const WITHDRAW_WAIT = { ms: LIMITS.withdrawWaitMs as number, pollMs: LIMITS.withdrawPollMs as number };

/** Step 2. Safe to call again with the same signed transaction; it never co-signs a second, different one. */
export async function submitWithdrawal(ctx: Ctx, user: User, withdrawId: string, signedTx: string): Promise<WithdrawSubmitResponse> {
  const chain = ctx.chain!;
  let w = await ctx.db.withdrawal.findUnique({ where: { id: withdrawId } });
  if (!w || w.userId !== user.id) throw notFound('No such withdrawal.');
  if (!OPEN.includes(w.status as WithdrawalStatus)) return view(ctx, w);

  const raw = Buffer.from(signedTx, 'base64');
  let parsed: Transaction;
  try {
    parsed = Transaction.from(raw);
  } catch {
    throw invalid('That is not a signed transaction.');
  }
  if (parsed.recentBlockhash !== w.blockhash) throw invalid('That is not the transaction that was prepared for this withdrawal.');
  if (!parsed.signature) throw invalid('The wallet has not signed the transaction.');
  const signature = bs58.encode(parsed.signature);
  // A withdrawal that is already out is only ever followed up, never co-signed for other bytes.
  if (w.status === 'submitted' && w.signature !== signature) return view(ctx, (await settleWithdrawal(ctx, w.id)) ?? w);

  const fresh = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (fresh.flagged || fresh.chainHold) {
    if (w.status === 'prepared') await ctx.db.$transaction((tx) => release(ctx, tx, w!, 'prepared', 'failed'));
    throw onHold();
  }
  if ((await chain.rpc.finalizedHeight()) > w.lastValidBlockHeight) return view(ctx, (await settleWithdrawal(ctx, w.id)) ?? w);

  // Checks the instruction, the amount, the accounts, the fee payer and the player's signature.
  let cosigned: Transaction;
  try {
    cosigned = await chain.operator.coSignWithdraw(raw, { wallet: new PublicKey(w.wallet), amount: chain.toBase(w.amount) });
  } catch (e) {
    if (e instanceof WithdrawCheckError) throw invalid(e.message.replace(/^Podium: /, ''));
    throw e;
  }

  const first = w.status === 'prepared';
  if (first) {
    const claimed = await ctx.db.withdrawal.updateMany({ where: { id: w.id, status: 'prepared' }, data: { status: 'submitted', signature } });
    if (claimed.count === 0) {
      // Another request got there first (or it was cancelled): follow up only.
      w = (await settleWithdrawal(ctx, w.id)) ?? w;
      return view(ctx, w);
    }
  }
  try {
    await chain.rpc.sendRawTransaction(cosigned.serialize(), { preflightCommitment: 'confirmed' });
  } catch (e) {
    const logs = Array.isArray((e as { logs?: unknown }).logs) ? ((e as { logs: string[] }).logs) : [];
    // The node simulated it and refused: nothing was broadcast. That is only certain for the
    // first send; after an earlier send the outcome is read from the chain instead.
    if (first && (logs.length > 0 || findCustomCode(e, logs) !== undefined)) {
      ctx.log.warn({ withdrawal: w.id, error: e instanceof Error ? e.message : String(e) }, 'withdrawal refused by the node');
      await ctx.db.$transaction((tx) => release(ctx, tx, w!, 'submitted', 'failed'));
      return view(ctx, (await ctx.db.withdrawal.findUniqueOrThrow({ where: { id: w.id } })));
    }
    ctx.log.warn(e, 'withdrawal send did not answer; waiting for the chain');
  }
  const until = Date.now() + WITHDRAW_WAIT.ms;
  for (;;) {
    w = (await settleWithdrawal(ctx, w.id).catch(() => null)) ?? w;
    if (w.status !== 'submitted' || Date.now() >= until) return view(ctx, w);
    await sleep(WITHDRAW_WAIT.pollMs);
  }
}

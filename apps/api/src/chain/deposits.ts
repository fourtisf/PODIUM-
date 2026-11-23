// Deposits of the devnet TEST token. The player's wallet sends the deposit to the program; the
// server credits the ledger only from what a confirmed transaction of OUR program logged, once
// per transaction signature.
import { parsePodiumLogs, playerPda } from '@podium/chain';
import type { User } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { LIMITS } from '../config';
import type { Ctx } from '../ctx';
import { AppError, invalid, notFound } from '../errors';
import { applyLedger } from '../services/ledger';
import { walletRequired } from './outbox';
import { logsOfProgram } from './rpc';

export const depositKey = (signature: string): string => 'deposit:' + signature;

/** The canonical base58 form of a transaction signature, or null. */
export function canonicalSignature(v: string): string | null {
  try {
    const b = bs58.decode(v);
    return b.length === 64 ? bs58.encode(b) : null;
  } catch {
    return null;
  }
}

export interface DepositResult {
  /** tChips credited by this call; 0 when this signature was credited before. */
  credited: number;
  amount: number;
  balance: number;
}

/**
 * Credits the deposit(s) that transaction `signature` made for THIS user's wallet. The ledger
 * idemKey is the signature, so it credits once however often and by whomever it is submitted.
 */
export async function creditDeposit(ctx: Ctx, user: Pick<User, 'id' | 'wallet'>, rawSignature: string): Promise<DepositResult> {
  const chain = ctx.chain!;
  if (!user.wallet) throw walletRequired();
  const signature = canonicalSignature(rawSignature);
  if (!signature) throw invalid('That is not a transaction signature.');
  const info = await chain.rpc.txInfo(signature);
  if (!info) throw notFound('That transaction is not confirmed yet. Try again in a moment.');
  if (!info.ok) throw invalid('That transaction failed, so nothing was deposited.');
  // Only lines our program logged while it was running count; other programs can log anything.
  const ours = logsOfProgram(info.logs, chain.programId.toBase58());
  if (ours === null) throw new AppError(503, 'unavailable', 'The transaction log is incomplete. Try again later.');
  let base = 0n;
  for (const e of parsePodiumLogs(ours)) {
    if (e.event !== 'deposit' || e.fields.wallet !== user.wallet) continue;
    if (!/^\d{1,20}$/.test(e.fields.amount ?? '')) throw invalid('That transaction is not a readable deposit.');
    base += BigInt(e.fields.amount!);
  }
  if (base === 0n) throw invalid('That transaction is not a deposit from your wallet.');
  if (base % chain.unit !== 0n) throw invalid('Deposits must be a whole number of tChips. This one is not, so it was not credited.');
  const amount = chain.toChips(base);
  if (amount > 2_000_000_000) throw invalid('That deposit is too large.');
  return ctx.db.$transaction(async (tx) => {
    const applied = await applyLedger(tx, { userId: user.id, amount, reason: 'deposit', idemKey: depositKey(signature), ref: signature, at: ctx.clock.now() });
    const u = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { balance: true } });
    return { credited: applied ? amount : 0, amount, balance: u.balance };
  });
}

const seenKey = (userId: string): string => 'chain:seen:' + userId;

/**
 * Reconcile: looks at the latest transactions of the player's on-chain account and credits any
 * confirmed deposit the browser never reported. Returns the tChips credited.
 */
export async function reconcileDeposits(ctx: Ctx, user: Pick<User, 'id' | 'wallet'>): Promise<number> {
  const chain = ctx.chain!;
  if (!user.wallet) return 0;
  const sigs = (await chain.rpc.signaturesFor(playerPda(new PublicKey(user.wallet), chain.programId), LIMITS.chainReconcileSignatures)).filter((s) => s.ok).map((s) => s.signature);
  if (!sigs.length) return 0;
  const key = seenKey(user.id);
  const seen = await ctx.redis.smismember(key, ...sigs);
  const fresh = sigs.filter((_, i) => !seen[i]);
  if (!fresh.length) return 0;
  const known = new Set((await ctx.db.ledger.findMany({ where: { idemKey: { in: fresh.map(depositKey) } }, select: { idemKey: true } })).map((l) => l.idemKey));
  let credited = 0;
  const done: string[] = [];
  for (const s of fresh.reverse()) {
    if (known.has(depositKey(s))) {
      done.push(s);
      continue;
    }
    try {
      credited += (await creditDeposit(ctx, user, s)).credited;
      done.push(s);
    } catch (e) {
      // 'invalid' = not a deposit of this wallet (an operator instruction, a withdrawal): never look again.
      if (e instanceof AppError && e.code === 'invalid') done.push(s);
      else if (!(e instanceof AppError)) ctx.log.warn(e, 'deposit reconcile failed');
    }
  }
  if (done.length) {
    await ctx.redis.sadd(key, ...done);
    await ctx.redis.expire(key, LIMITS.chainSeenKeepSeconds);
  }
  return credited;
}

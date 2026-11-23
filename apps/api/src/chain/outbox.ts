// The outbox that mirrors the Postgres ledger on-chain (devnet / localnet test token only).
//
// Postgres stays the authority for gameplay. Every money-like ledger effect also writes one
// ChainOp row IN THE SAME DATABASE TRANSACTION (enqueueOp). One worker (Redis lock) applies the
// rows strictly in id order through the Operator:
//   1. read the on-chain op_seq, store seq = op_seq + 1 and status 'sent', THEN send;
//   2. on success mark 'applied' with the signature;
//   3. after a crash, a 'sent' row whose seq the chain has reached was applied (this worker is
//      the only allocator of numbers); otherwise it is sent again with the same number;
//   4. when the PROGRAM rejects the operation the number was not consumed: the row is marked
//      'failed', the players involved are put on hold (no withdrawals until reviewed), it is
//      logged loudly and the queue moves on;
//   5. anything else (network, RPC, paused program) is retried with backoff and never skipped.
import { createHash } from 'node:crypto';
import { ECONOMY } from '@podium/shared';
import { PodiumProgramError, poolPda, splitToBps, type OpResult } from '@podium/chain';
import type { ChainOp, Period, Prisma } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import { LIMITS } from '../config';
import type { Ctx, Tx } from '../ctx';
import { AppError } from '../errors';
import { bump } from '../services/ledger';
import { token } from '../util';
import type { ChainService } from './service';

export type ChainOpKind = 'createPool' | 'enterPool' | 'closePool' | 'duelOpen' | 'duelJoin' | 'duelSettle' | 'duelRefund' | 'spend' | 'creditReward' | 'setFrozen';

/** Amounts are whole tChips; wallets are base58 addresses captured when the row is written. */
export interface OpPayloads {
  createPool: { kind: 0 | 1; game: string; start: number; end: number; entry: number; splitBps: number[]; winners: number };
  enterPool: { kind: 0 | 1; game: string; start: number; wallet: string };
  closePool: { kind: 0 | 1; game: string; start: number; winners: { wallet: string; chips: number; userId: string }[] };
  duelOpen: { duelId: string; wallet: string; chips: number; expiresAt: number };
  duelJoin: { duelId: string; wallet: string };
  duelSettle: { duelId: string; winner: string | null; chips: number };
  duelRefund: { duelId: string; wallet: string };
  spend: { wallet: string; chips: number; burn: number };
  creditReward: { wallet: string; chips: number };
  setFrozen: { wallet: string; frozen: boolean };
}

/** The on-chain clock may run a little behind or ahead of ours: on-chain duels accept a join this much longer. */
export const DUEL_CHAIN_GRACE_SECONDS = 3600;

/** A duel id (cuid) as the 16 bytes that name it on-chain. */
export function chainDuelId(duelId: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update('podium-duel:' + duelId).digest().subarray(0, 16));
}

export const poolKind = (kind: string): 0 | 1 => (kind === 'cup' ? 1 : 0);
const unix = (d: Date): number => Math.floor(+d / 1000);

export const walletRequired = (): AppError => new AppError(403, 'wallet_required', 'Link a Solana wallet first. tChips are a devnet test token that lives in your wallet.');

/** The player's linked wallet. Throws wallet_required when there is none. */
export async function walletOf(tx: Tx, userId: string): Promise<string> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { wallet: true } });
  if (!u?.wallet) throw walletRequired();
  return u.wallet;
}

/**
 * Queues one operation for the chain, in the caller's transaction. `ref` is deterministic (the
 * ledger idemKey or an entity id), so the same movement is queued at most once. No-op while
 * CHAIN_MODE is off.
 */
export async function enqueueOp<K extends ChainOpKind>(ctx: Ctx, tx: Tx, kind: K, ref: string, payload: OpPayloads[K], userId: string | null = null): Promise<void> {
  if (!ctx.chain) return;
  await tx.chainOp.createMany({ data: [{ kind, ref, userId, payload: payload as unknown as Prisma.InputJsonValue, createdAt: ctx.clock.now() }], skipDuplicates: true });
}

/** create_pool for a Period row that was just created: entry and split are fixed on-chain from here on. */
export async function enqueueCreatePool(ctx: Ctx, tx: Tx, p: Period): Promise<void> {
  if (!ctx.chain) return;
  const cup = p.kind === 'cup';
  const split = cup ? ECONOMY.cupSplit : ECONOMY.weeklySplit;
  await enqueueOp(ctx, tx, 'createPool', `pool:${p.id}`, {
    kind: poolKind(p.kind), game: p.game, start: unix(p.startAt), end: unix(p.endAt),
    entry: cup ? ECONOMY.cupEntry : ECONOMY.rankedEntry, splitBps: splitToBps(split), winners: split.length,
  });
}

// ---------------------------------------------------------------- rewards pot
// Rewards are paid from the on-chain rewards pot and can never exceed it. POT is the database's
// view of what is left after every reward that is already queued; claims reserve from it under a
// row lock, and the worker re-reads the chain when it is idle.
const POT = 'chain:rewardsPot';
const INT_MAX = 2_000_000_000;

/** Reserves up to `chips` of the rewards pot and returns what was granted (all of it while CHAIN_MODE is off). */
export async function reserveReward(ctx: Ctx, tx: Tx, chips: number): Promise<number> {
  if (!ctx.chain || chips <= 0) return chips;
  const left = await bump(tx, POT, 0); // takes the row lock
  const grant = Math.max(0, Math.min(chips, left));
  if (grant > 0) await bump(tx, POT, -grant);
  return grant;
}

export async function releaseReward(ctx: Ctx, tx: Tx, chips: number): Promise<void> {
  if (ctx.chain && chips > 0) await bump(tx, POT, chips);
}

/** POT = on-chain rewards balance minus the rewards still queued. Only called while no operation is in flight. */
export async function syncRewardsPot(ctx: Ctx): Promise<number> {
  const chain = ctx.chain!;
  return ctx.db.$transaction(async (tx) => {
    await bump(tx, POT, 0);
    const cfg = await chain.operator.config(true);
    const rows = await tx.$queryRaw<{ sum: bigint }[]>`
      SELECT COALESCE(SUM((payload->>'chips')::bigint), 0)::bigint AS sum FROM "ChainOp" WHERE kind = 'creditReward' AND status IN ('pending', 'sent')`;
    const onChain = cfg.rewardsBalance / chain.unit;
    const left = Number(onChain > BigInt(INT_MAX) ? BigInt(INT_MAX) : onChain) - Number(rows[0]?.sum ?? 0n);
    const value = Math.max(0, left);
    await tx.counter.update({ where: { key: POT }, data: { value } });
    return value;
  });
}

// ---------------------------------------------------------------- worker
const LOCK = 'lock:chainops';
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const REFRESH = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

/** Runs `fn` as the one chain worker. Returns null when another holder has the lock. */
export async function withChainLock<T>(ctx: Ctx, fn: (refresh: () => Promise<void>) => Promise<T>): Promise<T | null> {
  const owner = token(12);
  if ((await ctx.redis.set(LOCK, owner, 'PX', LIMITS.chainLockMs, 'NX')) !== 'OK') return null;
  try {
    return await fn(async () => void (await ctx.redis.eval(REFRESH, 1, LOCK, owner, String(LIMITS.chainLockMs))));
  } finally {
    await ctx.redis.eval(RELEASE, 1, LOCK, owner);
  }
}

function walletsIn(op: ChainOp): string[] {
  const p = op.payload as Record<string, unknown>;
  const out: string[] = [];
  if (typeof p.wallet === 'string') out.push(p.wallet);
  if (typeof p.winner === 'string') out.push(p.winner);
  if (Array.isArray(p.winners)) for (const w of p.winners as { wallet?: unknown }[]) if (typeof w?.wallet === 'string') out.push(w.wallet);
  return out;
}

function execute(chain: ChainService, op: ChainOp, seq: bigint): Promise<OpResult> {
  const o = chain.operator;
  const key = (w: string): PublicKey => new PublicKey(w);
  const kind = op.kind as ChainOpKind;
  switch (kind) {
    case 'createPool': {
      const p = op.payload as unknown as OpPayloads['createPool'];
      return o.createPool(seq, { kind: p.kind, game: p.game, periodStart: BigInt(p.start), periodEnd: BigInt(p.end), entry: chain.toBase(p.entry), splitBps: p.splitBps, winners: p.winners });
    }
    case 'enterPool': {
      const p = op.payload as unknown as OpPayloads['enterPool'];
      return o.enterPool(seq, poolPda(p.kind, p.game, p.start, chain.programId), key(p.wallet));
    }
    case 'closePool': {
      const p = op.payload as unknown as OpPayloads['closePool'];
      return o.closePool(seq, poolPda(p.kind, p.game, p.start, chain.programId), p.winners.map((w) => ({ wallet: key(w.wallet), payout: chain.toBase(w.chips) })));
    }
    case 'duelOpen': {
      const p = op.payload as unknown as OpPayloads['duelOpen'];
      return o.duelOpen(seq, { id: chainDuelId(p.duelId), creator: key(p.wallet), stake: chain.toBase(p.chips), expiresAt: BigInt(p.expiresAt) });
    }
    case 'duelJoin': {
      const p = op.payload as unknown as OpPayloads['duelJoin'];
      return o.duelJoin(seq, chainDuelId(p.duelId), key(p.wallet));
    }
    case 'duelSettle': {
      const p = op.payload as unknown as OpPayloads['duelSettle'];
      return o.duelSettle(seq, chainDuelId(p.duelId), p.winner ? key(p.winner) : null, chain.toBase(p.chips));
    }
    case 'duelRefund': {
      const p = op.payload as unknown as OpPayloads['duelRefund'];
      return o.duelRefund(seq, chainDuelId(p.duelId), key(p.wallet));
    }
    case 'spend': {
      const p = op.payload as unknown as OpPayloads['spend'];
      return o.spend(seq, key(p.wallet), chain.toBase(p.chips), chain.toBase(p.burn));
    }
    case 'creditReward': {
      const p = op.payload as unknown as OpPayloads['creditReward'];
      return o.creditReward(seq, key(p.wallet), chain.toBase(p.chips));
    }
    case 'setFrozen': {
      const p = op.payload as unknown as OpPayloads['setFrozen'];
      return o.setFrozen(seq, key(p.wallet), p.frozen);
    }
    default:
      throw new PodiumProgramError(undefined, -1, [], `unknown operation kind ${String(kind)}`);
  }
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/**
 * 'rejected': the program refused the operation for good (the number was not consumed).
 * 'retry': unknown or temporary; the operation stays where it is and is tried again.
 */
export function classify(e: unknown, kind: string, programId: string): { verdict: 'rejected' | 'retry'; text: string } {
  if (!(e instanceof PodiumProgramError)) return { verdict: 'retry', text: e instanceof Error ? e.message : String(e) };
  if (e.code) {
    // The admin paused the program, or the chain's clock has not reached the period end yet: wait.
    const wait = e.code === 'Paused' || e.code === 'BadSequence' || (e.code === 'PoolNotEnded' && kind === 'closePool');
    return { verdict: wait ? 'retry' : 'rejected', text: e.code };
  }
  // The System program failing means the operator cannot pay for a new account (out of SOL).
  // That is ours to fix, not the player's: wait, loudly.
  if (e.logs.some((l) => l.startsWith(`Program ${SYSTEM_PROGRAM} failed`))) return { verdict: 'retry', text: 'the operator could not pay for an account (is it out of SOL?)' };
  // Not one of the program's own errors. A custom code (Anchor's account checks, the token
  // program) or a failure inside our program's invocation is still a definite rejection.
  if (e.customCode !== undefined) return { verdict: 'rejected', text: `custom:${e.customCode}` };
  if (e.logs.some((l) => l.startsWith(`Program ${programId} failed`))) return { verdict: 'rejected', text: 'program failed' };
  return { verdict: 'retry', text: e.message };
}

async function reject(ctx: Ctx, op: ChainOp, error: string): Promise<void> {
  const users = new Set<string>();
  if (op.userId) users.add(op.userId);
  const winners = (op.payload as { winners?: { userId?: unknown }[] }).winners;
  if (Array.isArray(winners)) for (const w of winners) if (typeof w?.userId === 'string') users.add(w.userId);
  await ctx.db.$transaction([
    ctx.db.chainOp.update({ where: { id: op.id }, data: { status: 'failed', error, seq: null } }),
    ctx.db.user.updateMany({ where: { id: { in: [...users] } }, data: { chainHold: true } }),
  ]);
  ctx.log.error({ chainOp: op.id, kind: op.kind, ref: op.ref, error, held: [...users] }, 'CHAIN OP REJECTED BY THE PROGRAM: marked failed, players put on hold for review');
}

async function processOne(ctx: Ctx, chain: ChainService, op: ChainOp): Promise<'applied' | 'failed' | { stalled: string }> {
  const db = ctx.db;
  try {
    // Registration is not part of the operation: if it cannot be done now, the operation waits.
    for (const w of walletsIn(op)) await chain.ensureRegistered(w);
  } catch (e) {
    const text = 'could not register a wallet: ' + (e instanceof Error ? e.message : String(e));
    await db.chainOp.update({ where: { id: op.id }, data: { error: text.slice(0, 500) } }).catch(() => undefined);
    return { stalled: `${op.kind} #${op.id}: ${text}` };
  }
  try {
    const onChain = await chain.operator.opSeq();
    let seq = op.status === 'sent' ? op.seq : null;
    if (seq !== null) {
      // A row left 'sent' by a crash or a lost answer. This worker is the only one handing out
      // numbers, so a chain that has reached the number means this very operation was applied.
      if (onChain >= seq) {
        await db.chainOp.update({ where: { id: op.id }, data: { status: 'applied', error: null } });
        return 'applied';
      }
      if (seq !== onChain + 1n) {
        ctx.log.error({ chainOp: op.id, seq: String(seq), onChain: String(onChain) }, 'chain op_seq is behind a sent operation (was the validator reset?); renumbering');
        seq = null;
      }
    }
    if (seq === null) {
      seq = onChain + 1n;
      // The number is stored BEFORE anything is sent.
      await db.chainOp.update({ where: { id: op.id }, data: { status: 'sent', seq, attempts: { increment: 1 } } });
    } else await db.chainOp.update({ where: { id: op.id }, data: { attempts: { increment: 1 } } });
    const res = await execute(chain, op, seq);
    await db.chainOp.update({ where: { id: op.id }, data: { status: 'applied', signature: res.signature, error: null } });
    return 'applied';
  } catch (e) {
    const c = classify(e, op.kind, chain.programId.toBase58());
    if (c.verdict === 'rejected') {
      await reject(ctx, op, c.text);
      return 'failed';
    }
    await db.chainOp.update({ where: { id: op.id }, data: { error: c.text.slice(0, 500) } }).catch(() => undefined);
    return { stalled: `${op.kind} #${op.id}: ${c.text}` };
  }
}

export interface DrainReport {
  /** False when CHAIN_MODE is off or another worker held the lock. */
  ran: boolean;
  applied: number;
  failed: number;
  /** Set when the queue stopped at an operation that has to be retried later. */
  stalled: string | null;
}

/** Applies queued operations in id order until the queue is empty, `max` is reached or one has to wait. */
export async function drainChainOps(ctx: Ctx, opts: { max?: number } = {}): Promise<DrainReport> {
  const chain = ctx.chain;
  const none: DrainReport = { ran: false, applied: 0, failed: 0, stalled: null };
  if (!chain) return none;
  const max = opts.max ?? 10_000;
  const out = await withChainLock(ctx, async (refresh) => {
    const r: DrainReport = { ran: true, applied: 0, failed: 0, stalled: null };
    while (r.applied + r.failed < max) {
      const op = await ctx.db.chainOp.findFirst({ where: { status: { in: ['pending', 'sent'] } }, orderBy: { id: 'asc' } });
      if (!op) break;
      await refresh();
      const res = await processOne(ctx, chain, op);
      if (res === 'applied') r.applied++;
      else if (res === 'failed') r.failed++;
      else {
        r.stalled = res.stalled;
        break;
      }
    }
    if (r.applied + r.failed > 0) await syncRewardsPot(ctx).catch((e) => ctx.log.warn(e, 'rewards pot sync failed'));
    return r;
  });
  return out ?? none;
}

/** Starts the outbox worker of this process. Returns a function that stops it. */
export function startChainWorker(ctx: Ctx): () => void {
  if (!ctx.chain) return () => undefined;
  let stopped = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number): Promise<void> =>
    new Promise((res) => {
      const t = setTimeout(res, ms);
      t.unref();
      wake = () => {
        clearTimeout(t);
        res();
      };
    });
  void (async () => {
    let delay: number = LIMITS.chainPollMs;
    while (!stopped) {
      let busy = false;
      try {
        const r = await drainChainOps(ctx, { max: 50 });
        busy = !r.stalled && r.applied + r.failed >= 50;
        if (r.stalled) {
          delay = Math.min(delay * 2, LIMITS.chainBackoffMaxMs);
          ctx.log.warn({ stalled: r.stalled, retryInMs: delay }, 'chain outbox is waiting');
        } else delay = LIMITS.chainPollMs;
      } catch (e) {
        delay = Math.min(delay * 2, LIMITS.chainBackoffMaxMs);
        ctx.log.error(e, 'chain outbox failed');
      }
      if (!busy && !stopped) await sleep(delay);
    }
  })();
  return () => {
    stopped = true;
    wake?.();
  };
}

/**
 * How many of the player's operations are not on-chain yet. Pool closes carry their winners in
 * the payload, so a payout that is still queued counts for each winner.
 */
export async function pendingOpsOf(db: Tx, userId: string, wallet: string | null): Promise<number> {
  const own = await db.chainOp.count({ where: { userId, status: { in: ['pending', 'sent'] } } });
  if (!wallet) return own;
  const filter = JSON.stringify([{ wallet }]);
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "ChainOp" WHERE kind = 'closePool' AND status IN ('pending', 'sent') AND payload->'winners' @> ${filter}::jsonb`;
  return own + Number(rows[0]?.n ?? 0n);
}

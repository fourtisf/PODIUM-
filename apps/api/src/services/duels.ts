// Duels between real players. A player creates a duel and plays one run; the next player to pick the
// same game and stake plays against that stored score. Stakes are charged when the duel is created
// or joined, so the duel run itself is free.
import {
  DUEL_JOINER_TIMEOUT_HOURS, ECONOMY, XP, dayNum, duelFee, duelPayout, fmt, gameMeta, type CreateDuelResponse, type DuelHistoryItem,
  type DuelView, type DuelsResponse, type FinishRunResponse, type GameKey, type MissionId,
} from '@podium/shared';
import type { Duel, User } from '@prisma/client';
import { LIMITS } from '../config';
import type { Ctx, Tx } from '../ctx';
import { DUEL_CHAIN_GRACE_SECONDS, enqueueOp, walletOf } from '../chain/outbox';
import { conflict, invalid, notFound } from '../errors';
import { esc } from '../util';
import { addFee, applyLedger, lockUser } from './ledger';
import { trackDuelWin } from './missions';
import { addActivity, notify } from './notifications';

const HOUR = 3_600_000;

async function lockDuel(tx: Tx, id: string): Promise<Duel | null> {
  await tx.$queryRaw`SELECT id FROM "Duel" WHERE id = ${id} FOR UPDATE`;
  return tx.duel.findUnique({ where: { id } });
}

async function nameOf(db: Tx, id: string | null): Promise<string | null> {
  return id ? ((await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? null) : null;
}

export async function duelView(db: Tx, d: Duel, userId: string): Promise<DuelView> {
  const creator = d.creatorId === userId;
  const myScore = creator ? d.creatorScore : d.joinerScore;
  const played = (await db.run.count({ where: { duelId: d.id, userId } })) > 0;
  return {
    id: d.id, game: d.game as GameKey, stake: d.stake, status: d.status as DuelView['status'], role: creator ? 'creator' : 'joiner', myScore,
    canPlay: !played && ((creator && d.status === 'waiting') || (!creator && d.status === 'matched')),
    target: creator ? null : d.creatorScore,
    opponent: await nameOf(db, creator ? d.joinerId : d.creatorId),
    expiresAt: d.expiresAt.toISOString(),
  };
}

/** The duel a player still has to play: created without a score yet, or joined and not finished. */
const openDuelOf = (db: Tx, userId: string): Promise<Duel | null> =>
  db.duel.findFirst({ where: { OR: [{ creatorId: userId, status: 'waiting', creatorScore: null }, { joinerId: userId, status: 'matched' }] }, orderBy: { createdAt: 'desc' } });

export async function createOrJoinDuel(ctx: Ctx, tx: Tx, user: User, game: GameKey, stake: number): Promise<CreateDuelResponse> {
  const now = ctx.clock.now();
  await lockUser(tx, user.id);
  if (await openDuelOf(tx, user.id)) throw conflict('Finish your open duel first.');
  // Oldest waiting duel with a recorded score. SKIP LOCKED: two joiners never take the same one.
  const found = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Duel"
    WHERE game = ${game} AND stake = ${stake} AND status = 'waiting' AND "creatorScore" IS NOT NULL
      AND "creatorId" <> ${user.id} AND "expiresAt" > ${now}
    ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
  let duel: Duel;
  const role: 'creator' | 'joiner' = found.length ? 'joiner' : 'creator';
  if (found.length) duel = await tx.duel.update({ where: { id: found[0]!.id }, data: { status: 'matched', joinerId: user.id, matchedAt: now } });
  else duel = await tx.duel.create({ data: { game, stake, creatorId: user.id, createdAt: now, expiresAt: new Date(+now + ECONOMY.duelExpiryHours * HOUR) } });
  await applyLedger(tx, { userId: user.id, amount: -stake, reason: 'duel', idemKey: `duel:${duel.id}:stake:${user.id}`, ref: duel.id, at: now, stat: 'spent' });
  if (ctx.chain) {
    // The stake is locked in the on-chain duel escrow: duel_open for the creator, duel_join for the joiner.
    const wallet = await walletOf(tx, user.id);
    if (role === 'creator') {
      await enqueueOp(ctx, tx, 'duelOpen', `duel:${duel.id}:open`, { duelId: duel.id, wallet, chips: stake, expiresAt: Math.floor(+duel.expiresAt / 1000) + DUEL_CHAIN_GRACE_SECONDS }, user.id);
    } else await enqueueOp(ctx, tx, 'duelJoin', `duel:${duel.id}:join`, { duelId: duel.id, wallet }, user.id);
  }
  const view = await duelView(tx, duel, user.id);
  const u = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
  return { duel: view, role, target: view.target, opponent: view.opponent, balance: u.balance };
}

/** Checks that `userId` may start their one run of this duel. Called inside the run-start transaction. */
export async function duelRunStart(tx: Tx, duelId: string, userId: string, game: GameKey, now: Date): Promise<void> {
  const d = await lockDuel(tx, duelId);
  if (!d || (d.creatorId !== userId && d.joinerId !== userId)) throw notFound('No such duel.');
  if (d.game !== game) throw invalid('That duel is for another game.');
  const creator = d.creatorId === userId;
  const ready = creator ? d.status === 'waiting' && d.creatorScore === null && d.expiresAt > now : d.status === 'matched' && d.joinerScore === null;
  if (!ready) throw conflict('That duel is not waiting for your run.');
  if (await tx.run.count({ where: { duelId, userId } })) throw conflict('You already played your run of this duel.');
}

type DuelOutcome = NonNullable<FinishRunResponse['duel']>;
export interface DuelSettled {
  view: DuelOutcome;
  duelWin: boolean;
  xp: number;
}

/** Pays the winner, records the fee, XP, stats and notifications, and closes the duel. */
async function settle(ctx: Ctx, tx: Tx, d: Duel, winnerId: string, joinerScore: number | null, now: Date): Promise<{ payout: number; missions: MissionId[] }> {
  const loserId = winnerId === d.creatorId ? d.joinerId! : d.creatorId;
  const payout = duelPayout(d.stake);
  await applyLedger(tx, { userId: winnerId, amount: payout, reason: 'duel', idemKey: `duel:${d.id}:win`, ref: d.id, at: now, stat: 'won' });
  if (ctx.chain) await enqueueOp(ctx, tx, 'duelSettle', `duel:${d.id}:settle`, { duelId: d.id, winner: await walletOf(tx, winnerId), chips: payout }, winnerId);
  await addFee(tx, duelFee(d.stake), now);
  const winner = await tx.user.update({ where: { id: winnerId }, data: { xp: { increment: XP.duelWin }, duelsWon: { increment: 1 } } });
  const loser = await tx.user.update({ where: { id: loserId }, data: { xp: { increment: XP.duelLoss }, duelsLost: { increment: 1 } } });
  await tx.duel.update({ where: { id: d.id }, data: { status: 'settled', winnerId, joinerScore, settledAt: now } });
  const game = gameMeta(d.game as GameKey).name;
  await notify(tx, winnerId, 'duel', `You won a duel against <b>${esc(loser.name)}</b> for ${fmt(payout)} tChips.`, now);
  await notify(tx, loserId, 'duel', `<b>${esc(winner.name)}</b> beat you in a <b>${esc(game)}</b> duel.`, now);
  await addActivity(tx, winner.name, 'won a duel in', game, now);
  // The joiner's win is credited to missions by their run; the creator's win has to be credited here.
  const missions = winnerId === d.creatorId ? await trackDuelWin(tx, winnerId, dayNum(now), d.game, now) : [];
  return { payout, missions };
}

/**
 * Called when a duel run has been judged. `score` is the accepted server score, or null when the
 * run was rejected or flagged (that player forfeits).
 *  - creator, accepted: the score is stored and the duel waits for a joiner;
 *  - creator, forfeited: nobody else is in the duel yet, so there is nobody to pay. The duel is
 *    closed as 'settled' with no winner and the stake goes to the fee counter (no refund);
 *  - joiner, accepted: higher score wins, a tie goes to the earlier score (the creator);
 *  - joiner, forfeited: the creator wins.
 */
export async function duelRunJudged(ctx: Ctx, tx: Tx, duelId: string, userId: string, score: number | null, now: Date): Promise<DuelSettled> {
  const d = await lockDuel(tx, duelId);
  const none: DuelSettled = { view: { won: false, opponent: null, opponentScore: null, payout: 0, stake: d?.stake ?? 0 }, duelWin: false, xp: 0 };
  if (!d) return none;
  if (d.creatorId === userId) {
    if (d.status !== 'waiting' || d.creatorScore !== null) return none; // refunded or already played
    if (score === null) {
      await tx.duel.update({ where: { id: d.id }, data: { status: 'settled', winnerId: null, settledAt: now } });
      await addFee(tx, d.stake, now);
      // On-chain: the open duel is settled with no winner, the stake goes to the treasury.
      await enqueueOp(ctx, tx, 'duelSettle', `duel:${d.id}:settle`, { duelId: d.id, winner: null, chips: 0 }, userId);
      await notify(tx, userId, 'duel', 'Your duel run was not accepted, so the duel was closed and the stake is forfeited.', now);
      return none;
    }
    await tx.duel.update({ where: { id: d.id }, data: { creatorScore: score, creatorAt: now } });
    return { view: { won: null, opponent: null, opponentScore: null, payout: 0, stake: d.stake }, duelWin: false, xp: 0 };
  }
  if (d.joinerId !== userId || d.status !== 'matched') return none;
  const won = score !== null && score > (d.creatorScore ?? 0);
  const { payout } = await settle(ctx, tx, d, won ? userId : d.creatorId, score, now);
  return {
    view: { won, opponent: await nameOf(tx, d.creatorId), opponentScore: d.creatorScore, payout: won ? payout : 0, stake: d.stake },
    duelWin: won,
    xp: won ? XP.duelWin : XP.duelLoss,
  };
}

export async function duelsView(ctx: Ctx, user: User): Promise<DuelsResponse> {
  const db = ctx.db;
  const open = await openDuelOf(db, user.id);
  const waiting = await db.duel.findMany({ where: { creatorId: user.id, status: 'waiting', creatorScore: { not: null } }, orderBy: { createdAt: 'desc' }, take: LIMITS.duelHistory });
  const done = await db.duel.findMany({
    where: { status: 'settled', joinerId: { not: null }, OR: [{ creatorId: user.id }, { joinerId: user.id }] },
    orderBy: { settledAt: 'desc' },
    take: LIMITS.duelHistory,
  });
  const names = new Map((await db.user.findMany({ where: { id: { in: done.map((d) => (d.creatorId === user.id ? d.joinerId! : d.creatorId)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const history: DuelHistoryItem[] = done.map((d) => {
    const creator = d.creatorId === user.id;
    const win = d.winnerId === user.id;
    return {
      id: d.id, game: d.game as GameKey, opponent: names.get(creator ? d.joinerId! : d.creatorId) ?? '',
      myScore: creator ? d.creatorScore : d.joinerScore, theirScore: creator ? d.joinerScore : d.creatorScore,
      win, amount: win ? duelPayout(d.stake) - d.stake : -d.stake,
    };
  });
  return {
    open: open ? await duelView(db, open, user.id) : null,
    waiting: await Promise.all(waiting.map((d) => duelView(db, d, user.id))),
    history, won: user.duelsWon, lost: user.duelsLost,
  };
}

/**
 * Job: refunds the creator's stake when nobody joined before the duel expired, and gives the win to
 * the creator when a joiner matched but did not finish a run in time. Safe to run repeatedly.
 */
export async function expireDuels(ctx: Ctx, now: Date): Promise<{ refunded: number; forfeited: number }> {
  let refunded = 0;
  let forfeited = 0;
  const due = await ctx.db.duel.findMany({ where: { status: 'waiting', expiresAt: { lte: now } }, select: { id: true }, take: 500 });
  for (const { id } of due) {
    await ctx.db.$transaction(async (tx) => {
      const d = await lockDuel(tx, id);
      if (!d || d.status !== 'waiting' || d.expiresAt > now) return;
      await tx.duel.update({ where: { id }, data: { status: 'refunded', settledAt: now } });
      await applyLedger(tx, { userId: d.creatorId, amount: d.stake, reason: 'duel_refund', idemKey: `refund:${d.id}`, ref: d.id, at: now, stat: 'unspent' });
      if (ctx.chain) await enqueueOp(ctx, tx, 'duelRefund', `duel:${d.id}:refund`, { duelId: d.id, wallet: await walletOf(tx, d.creatorId) }, d.creatorId);
      await notify(tx, d.creatorId, 'duel', `Nobody joined your <b>${esc(gameMeta(d.game as GameKey).name)}</b> duel, so your ${fmt(d.stake)} tChips are back.`, now);
      refunded++;
    });
  }
  const stale = await ctx.db.duel.findMany({ where: { status: 'matched', matchedAt: { lte: new Date(+now - DUEL_JOINER_TIMEOUT_HOURS * HOUR) } }, select: { id: true }, take: 500 });
  for (const { id } of stale) {
    await ctx.db.$transaction(async (tx) => {
      const d = await lockDuel(tx, id);
      if (!d || d.status !== 'matched') return;
      await settle(ctx, tx, d, d.creatorId, null, now);
      forfeited++;
    });
  }
  return { refunded, forfeited };
}

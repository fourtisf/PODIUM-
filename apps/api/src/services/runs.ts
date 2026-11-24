// Runs: start (charge the entry), judge (Phase 1 sanity + Phase 2 replay and stream checks) and
// settle (scores, XP, boxes, missions, duels, challenges, referral) exactly once per run.
import { maxPlausibleScore, pressStats, replay, validateLog } from '@podium/games';
import {
  ANTI_ABUSE, BRAND, ECONOMY, REFERRAL, XP, cupGame, dayNum, fmt, gameMeta, isGameKey, levelOf, projectedPrize, weekKey,
  type ApiError, type FinishRunRequest, type FinishRunResponse, type GameKey, type MissionId, type RunBadge, type RunMode,
  type StartRunRequest, type StartRunResponse,
} from '@podium/shared';
import type { Period, Run, User } from '@prisma/client';
import { LIMITS, TX } from '../config';
import type { After, Ctx, Tx } from '../ctx';
import { enqueueOp, poolKind, walletOf } from '../chain/outbox';
import { AppError, conflict, invalid, notFound } from '../errors';
import { esc, seededUnit } from '../util';
import { GAMES_CACHE, boardChanged, placeOf, splitFor } from './boards';
import { duelRunJudged, duelRunStart } from './duels';
import { currentVersion, versionDef } from './gameVersions';
import { applyLedger, lockUser, payReward } from './ledger';
import { trackRun } from './missions';
import { addActivity, notify } from './notifications';
import { cupPeriod, weeklyPeriod } from './periods';
import { rewardsUnlocked } from './users';
import type { StreamSnapshot } from './stream';

const MS_PER_FRAME = 1000 / 60;
const COMPETITIVE: ReadonlyArray<string> = ['ranked', 'cup', 'duel'];

export interface Handled<T> {
  status: number;
  body: T;
  after?: After;
}

/** Whether a ranked or Cup run drops a mystery box: decided from the run id and the server secret, so a replay agrees. */
export const runDropsBox = (secret: string, runId: string): boolean => seededUnit(secret, 'box:' + runId) < ECONOMY.boxDropChance;

/** Key of the stored result of a run, so a second finish (any Idempotency-Key) gets the first answer. */
export const runResultKey = (runId: string): string => 'run:' + runId;

// ---------------------------------------------------------------- start
export async function startRun(ctx: Ctx, tx: Tx, user: User, body: StartRunRequest): Promise<Handled<StartRunResponse>> {
  const now = ctx.clock.now();
  const game = body.game;
  await lockUser(tx, user.id);
  let entry = 0;
  let period: Period | null = null;
  let free = false;
  if (body.mode === 'practice') {
    // The first practice runs are free; after that practice costs a little and is not pooled.
    free = (await tx.user.updateMany({ where: { id: user.id, freePractice: { gt: 0 } }, data: { freePractice: { decrement: 1 } } })).count === 1;
    // The practice entry is not pooled anywhere, so in chain mode practice is free: no tChips exist off-chain only.
    entry = free || ctx.chain ? 0 : ECONOMY.practiceEntry;
  } else if (body.mode === 'ranked') {
    period = await weeklyPeriod(tx, game, now, ctx);
    entry = ECONOMY.rankedEntry;
  } else if (body.mode === 'cup') {
    if (game !== cupGame(now)) throw invalid(`This week's Cup game is ${gameMeta(cupGame(now)).name}.`);
    period = await cupPeriod(tx, now, ctx);
    entry = ECONOMY.cupEntry;
  } else if (body.mode === 'duel') {
    if (!body.duelId) throw invalid('duelId is required for a duel run.');
    await duelRunStart(tx, body.duelId, user.id, game, now);
  } else {
    if (!body.challengeCode) throw invalid('challengeCode is required for a challenge run.');
    const ch = await tx.challenge.findUnique({ where: { code: body.challengeCode.toUpperCase() } });
    if (!ch) throw notFound('No such challenge.');
    if (ch.game !== game) throw invalid('That challenge is for another game.');
    if (ch.userId === user.id) throw invalid('You cannot take your own challenge.');
  }
  const run = await tx.run.create({
    data: {
      userId: user.id, game, gameVersion: currentVersion(game), mode: body.mode, seed: ctx.seed(), entry, createdAt: now,
      periodId: period?.id ?? null, duelId: body.mode === 'duel' ? body.duelId! : null,
      challengeCode: body.mode === 'challenge' ? body.challengeCode!.toUpperCase() : null,
    },
  });
  await applyLedger(tx, { userId: user.id, amount: -entry, reason: 'entry', idemKey: `entry:${run.id}`, ref: run.id, at: now, stat: 'spent' });
  // Ranked and Cup entries go to the pool in full; the platform fee is taken when the period closes.
  if (period && entry) {
    const p = await tx.period.update({ where: { id: period.id }, data: { pool: { increment: entry } } });
    if (ctx.chain) {
      // The on-chain pool takes no entry once it is closed, so neither does the ledger.
      if (p.closed) throw conflict('That week just closed. Start the run again.');
      await enqueueOp(ctx, tx, 'enterPool', `entry:${run.id}`, { kind: poolKind(p.kind), game: p.game, start: Math.floor(+p.startAt / 1000), wallet: await walletOf(tx, user.id) }, user.id);
    }
  }
  const u = await tx.user.update({ where: { id: user.id }, data: { plays: { increment: 1 } } });
  return {
    status: 200,
    body: { runId: run.id, seed: run.seed, gameVersion: run.gameVersion, entry, balance: u.balance, freePractice: u.freePractice, streamToken: ctx.stream.token(run.id, now) },
    after: async () => void (period && (await ctx.redis.del(GAMES_CACHE))),
  };
}

// ---------------------------------------------------------------- judge
export type Verdict =
  | { kind: 'reject'; reason: string }
  | { kind: 'ok'; score: number; seconds: number; note?: string }
  | { kind: 'flag'; score: number; seconds: number; reason: string };

export interface RunInput {
  frames: number;
  log: number[];
  /** What the browser claimed; null when the server ended the run itself. */
  clientScore: number | null;
  /** Set when the server ended the run from its stream (timeout or stall) instead of a client finish. */
  serverEnded?: string;
}

/** Pure judgement of a finished run. Touches no database. */
export function judge(run: Run, input: RunInput, now: Date, stream: StreamSnapshot | null, requireStream: boolean): Verdict {
  const game = run.game as GameKey;
  const { frames, log } = input;
  const elapsed = +now - +run.createdAt;
  const competitive = COMPETITIVE.includes(run.mode);
  if (!isGameKey(game)) return { kind: 'reject', reason: 'unknown game' };
  if (!Number.isInteger(frames) || frames < 1) return { kind: 'reject', reason: 'no frames played' };
  if (frames > ANTI_ABUSE.maxRunSeconds * 60) return { kind: 'reject', reason: 'run is longer than the limit' };
  const bad = validateLog(log, frames);
  if (bad) return { kind: 'reject', reason: bad };
  if (!input.serverEnded) {
    if (elapsed > ANTI_ABUSE.sessionSeconds * 1000) return { kind: 'reject', reason: 'session expired' };
    // A finish that arrives sooner than the run could have lasted.
    if (frames * MS_PER_FRAME > elapsed + LIMITS.clockSlackMs) return { kind: 'reject', reason: 'finished sooner than the run could have lasted' };
    // Phase 1 sanity: the claimed score must be possible in that time at all.
    if ((input.clientScore ?? 0) > maxPlausibleScore(game, frames / 60)) return { kind: 'reject', reason: 'score is impossible for the run\'s duration' };
  }
  const def = versionDef(game, run.gameVersion);
  if (!def) return { kind: 'reject', reason: 'unknown game version' };

  // Phase 2: the server's replay decides the score.
  const r = replay(def, run.seed, log, frames);
  // A competitive run only ends by dying, exactly at the last frame. Practice and challenge runs
  // (and runs the server ended itself) take the replayed score at the frame they stopped.
  if (competitive && !input.serverEnded && !(r.dead && r.frames === frames)) return { kind: 'reject', reason: 'replay does not end where the run says it did' };
  const seconds = r.frames / 60;

  if (requireStream && competitive && !input.serverEnded) {
    if (!stream) return { kind: 'reject', reason: 'no live input stream' };
    if (stream.to > frames) return { kind: 'reject', reason: 'stream ran past the end of the run' };
    if (frames - stream.to > (ANTI_ABUSE.streamEveryMs * 3) / MS_PER_FRAME) return { kind: 'reject', reason: 'live input stream does not cover the run' };
    const s = stream.events;
    if (s.length > log.length) return { kind: 'reject', reason: 'input log does not match the live stream' };
    for (let i = 0; i < s.length; i++) if (s[i] !== log[i]) return { kind: 'reject', reason: 'input log does not match the live stream' };
    // Nothing may be slipped into the part of the run that was already streamed.
    if (s.length < log.length && log[s.length]! < stream.to) return { kind: 'reject', reason: 'input log does not match the live stream' };
  }

  const ps = pressStats(log);
  if (ps.peakPerSecond > ANTI_ABUSE.maxPressesPerSecond || ps.presses / Math.max(1, seconds) > ANTI_ABUSE.maxPressesPerSecond) {
    return { kind: 'reject', reason: 'too many inputs per second' };
  }
  if (ps.presses >= ANTI_ABUSE.regularityMinPresses && ps.intervalCv < ANTI_ABUSE.regularityCv) {
    return { kind: 'flag', score: r.score, seconds, reason: 'machine-regular input timing' };
  }
  return { kind: 'ok', score: r.score, seconds, note: input.serverEnded };
}

// ---------------------------------------------------------------- settle
class AlreadySettled extends Error {}

async function top5(tx: Tx, periodId: string, me: string): Promise<FinishRunResponse['top5']> {
  const rows = await tx.score.findMany({ where: { periodId }, orderBy: [{ score: 'desc' }, { setAt: 'asc' }], take: 5, select: { userId: true, score: true, user: { select: { name: true } } } });
  return rows.map((r, i) => ({ place: i + 1, name: r.user.name, score: r.score, me: r.userId === me }));
}

/** The inviter's reward: paid once the invited player has done enough ranked runs, capped per inviter per week. */
async function payInviter(ctx: Ctx, tx: Tx, invited: User, now: Date): Promise<void> {
  if (!invited.referredById || invited.refPaid || invited.rankedDone < REFERRAL.rankedRunsNeeded) return;
  const inviter = await tx.user.findUnique({ where: { id: invited.referredById } });
  // Phase 2 gating also applies to the inviter. While they are not eligible (or over this week's
  // cap) the reward stays pending and is tried again on the invited player's next ranked run.
  if (!inviter || !rewardsUnlocked(inviter)) return;
  // Chain mode: the bonus is a reward from the on-chain pot and needs the inviter's wallet. It stays pending without one.
  if (ctx.chain && !inviter.wallet) return;
  const week = weekKey(now);
  if ((await tx.referralReward.count({ where: { inviterId: inviter.id, week } })) >= REFERRAL.inviterWeeklyCap) return;
  const made = await tx.referralReward.createMany({ data: [{ inviterId: inviter.id, invitedId: invited.id, week, createdAt: now }], skipDuplicates: true });
  if (made.count === 0) return;
  const paid = await payReward(ctx, tx, { userId: inviter.id, amount: REFERRAL.inviterBonus, reason: 'referral', idemKey: `referral:inviter:${invited.id}`, ref: invited.id, at: now });
  await tx.user.update({ where: { id: invited.id }, data: { refPaid: true } });
  await notify(tx, inviter.id, 'referral', `<b>${esc(invited.name)}</b> joined through your invite and played. <b>+${ctx.chain ? paid : REFERRAL.inviterBonus} tChips</b>.`, now);
}

/**
 * Writes the outcome of a judged run. Runs inside one transaction and claims the run with a
 * conditional update (status 'open' → final), so two finishes can never both settle it.
 */
export async function settleRun(ctx: Ctx, tx: Tx, runId: string, input: RunInput, verdict: Verdict, streamedTo: number): Promise<Handled<FinishRunResponse | ApiError>> {
  const now = ctx.clock.now();
  const pre = await tx.run.findUniqueOrThrow({ where: { id: runId } });
  await lockUser(tx, pre.userId);
  const status = verdict.kind === 'reject' ? 'rejected' : verdict.kind === 'flag' ? 'flagged' : 'finished';
  const storeLog = Array.isArray(input.log) && input.log.length <= 1_200_000 && input.log.every((n) => typeof n === 'number');
  const claimed = await tx.run.updateMany({
    where: { id: runId, status: 'open' },
    data: {
      status, finishedAt: now, durationMs: Math.min(2 ** 31 - 1, +now - +pre.createdAt),
      score: verdict.kind === 'reject' ? null : verdict.score,
      clientScore: input.clientScore !== null && Number.isInteger(input.clientScore) ? Math.min(input.clientScore, 2 ** 31 - 1) : null,
      frames: Number.isInteger(input.frames) ? Math.max(0, Math.min(input.frames, 2 ** 31 - 1)) : null,
      inputLog: storeLog ? Buffer.from(JSON.stringify(input.log)) : null,
      streamedTo, rewardsHeld: verdict.kind === 'flag',
      reason: verdict.kind === 'reject' || verdict.kind === 'flag' ? verdict.reason : (verdict.note ?? null),
    },
  });
  if (claimed.count === 0) throw new AlreadySettled();
  const run = { ...pre, status };
  const game = run.game as GameKey;
  const mode = run.mode as RunMode;
  const after: After[] = [() => ctx.stream.clear(runId)];
  const finishAfter: After = async () => {
    for (const a of after) await a();
  };
  const save = async (statusCode: number, body: FinishRunResponse | ApiError): Promise<Handled<FinishRunResponse | ApiError>> => {
    await tx.idempotency.create({ data: { key: runResultKey(runId), status: statusCode, body: body as object, createdAt: now } });
    return { status: statusCode, body, after: finishAfter };
  };
  const userView = async (): Promise<FinishRunResponse['user']> => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: run.userId } });
    return { balance: u.balance, xp: u.xp, level: levelOf(u.xp), boxes: u.boxes };
  };

  // Rejected or flagged: the entry is not refunded and nothing is recorded. In a duel that player forfeits.
  if (verdict.kind !== 'ok') {
    if (mode === 'duel' && run.duelId) await duelRunJudged(ctx, tx, run.duelId, run.userId, null, now);
    if (verdict.kind === 'reject') return save(422, new AppError(422, 'run_rejected', verdict.reason).body());
    return save(200, {
      runId, status: 'flagged', game, mode, score: verdict.score, place: 0, newBest: false, xpGained: 0, boxDropped: false, badges: ['held'],
      prizeIfHeld: 0, rewardsHeld: true, top5: [], user: await userView(), missionsCompleted: [],
    });
  }

  return save(200, await creditAccepted(ctx, tx, run, verdict.score, verdict.seconds, now, after));
}

/**
 * Everything an accepted run earns: board, XP, box roll, duel or challenge outcome, referral and
 * missions. Shared by a normal finish and by an operator approving a flagged run. The caller has
 * claimed the run (so this runs once per run) and holds the player's row lock.
 */
async function creditAccepted(ctx: Ctx, tx: Tx, run: Run, score: number, seconds: number, now: Date, after: After[]): Promise<FinishRunResponse> {
  const runId = run.id;
  const game = run.game as GameKey;
  const mode = run.mode as RunMode;
  const userView = async (): Promise<FinishRunResponse['user']> => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: run.userId } });
    return { balance: u.balance, xp: u.xp, level: levelOf(u.xp), boxes: u.boxes };
  };
  const badges: RunBadge[] = [];
  let xp = 0;
  let place = 0;
  let newBest = false;
  let boxDropped = false;
  let prizeIfHeld = 0;
  let duelWin = false;
  let challengeWin = false;
  let rows: FinishRunResponse['top5'] = [];
  let duel: FinishRunResponse['duel'];
  let challenge: FinishRunResponse['challenge'];
  const me = await tx.user.findUniqueOrThrow({ where: { id: run.userId } });

  if (mode === 'ranked' || mode === 'cup') {
    const period = run.periodId ? await tx.period.findUnique({ where: { id: run.periodId } }) : null;
    const old = period ? await tx.score.findUnique({ where: { periodId_userId: { periodId: period.id, userId: me.id } } }) : null;
    // A run that finishes after its period closed is too late for that board (the entry was in the pool that was paid).
    const boardOpen = !!period && !period.closed;
    newBest = boardOpen && score > 0 && (!old || score > old.score);
    if (seconds >= XP.minRunSeconds) xp += mode === 'cup' ? XP.cupRun : XP.rankedRun;
    if (newBest) xp += XP.personalBest;
    boxDropped = runDropsBox(ctx.cfg.sessionSecret, runId);
    if (period && newBest) {
      await tx.score.upsert({
        where: { periodId_userId: { periodId: period.id, userId: me.id } },
        create: { periodId: period.id, userId: me.id, score, setAt: now, runId },
        update: { score, setAt: now, runId },
      });
      const label = mode === 'cup' ? `${BRAND.name} Cup` : gameMeta(game).name;
      await addActivity(tx, me.name, `scored ${fmt(score)} in`, label, now);
      // "Passed you": real players who were ahead of my previous best and are behind the new one.
      const passed = await tx.score.findMany({
        where: {
          periodId: period.id, userId: { not: me.id }, score: { lt: score },
          ...(old ? { OR: [{ score: { gt: old.score } }, { score: old.score, setAt: { lt: old.setAt } }] } : {}),
        },
        orderBy: [{ score: 'desc' }, { setAt: 'asc' }],
        take: LIMITS.passedYouMax,
      });
      for (const p of passed) {
        const theirs = await placeOf(tx, period.id, p.score, p.setAt);
        await notify(tx, p.userId, 'passed', `<b>${esc(me.name)}</b> passed you in <b>${esc(label)}</b> with ${fmt(score)}. You are now place ${theirs}.`, now);
      }
      after.push(() => boardChanged(ctx, period, me.id, score, now));
    }
    const best = newBest ? { score, setAt: now } : old;
    if (period && best) {
      place = await placeOf(tx, period.id, best.score, best.setAt);
      prizeIfHeld = projectedPrize(period.pool, splitFor(period.kind), place);
      rows = await top5(tx, period.id, me.id);
    }
    if (newBest) badges.push('new_best');
    if (prizeIfHeld > 0 || (place > 0 && place <= splitFor(mode === 'cup' ? 'cup' : 'weekly').length)) badges.push('prize_zone');
    if (boxDropped) badges.push('box');
    const ranked = mode === 'ranked' ? 1 : 0;
    const u = await tx.user.update({
      where: { id: me.id },
      data: { xp: { increment: xp }, boxes: { increment: boxDropped ? 1 : 0 }, rankedDone: { increment: ranked }, validatedRanked: { increment: ranked } },
    });
    if (ranked) await payInviter(ctx, tx, u, now);
  } else if (mode === 'duel' && run.duelId) {
    const d = await duelRunJudged(ctx, tx, run.duelId, me.id, score, now);
    duel = d.view;
    duelWin = d.duelWin;
    xp = d.xp; // already added by the duel settlement
    badges.push(d.view.won === null ? 'duel_waiting' : d.duelWin ? 'duel_won' : 'duel_lost');
    if (d.view.opponent !== null && d.view.opponentScore !== null) {
      const pair = [{ name: me.name, score, me: true, first: false }, { name: d.view.opponent, score: d.view.opponentScore, me: false, first: true }];
      // A tie goes to the earlier score, which is always the creator's.
      pair.sort((a, b) => b.score - a.score || Number(b.first) - Number(a.first));
      rows = pair.map((p, i) => ({ place: i + 1, name: p.name, score: p.score, me: p.me }));
    }
  } else if (mode === 'challenge' && run.challengeCode) {
    const ch = await tx.challenge.findUnique({ where: { code: run.challengeCode } });
    if (ch) {
      const won = score > ch.score;
      // Beating someone else's challenge counts for the "win a duel or beat a challenge" mission (every attempt, not only the first).
      challengeWin = won && ch.userId !== me.id;
      const owner = await tx.user.findUnique({ where: { id: ch.userId }, select: { name: true } });
      // Challenge runs are free, so XP is given for the first attempt at each challenge only.
      const first = (await tx.run.count({ where: { userId: me.id, challengeCode: ch.code, status: 'finished', id: { not: runId } } })) === 0;
      if (first) {
        xp = won ? XP.challengeWin : XP.challengeLoss;
        await tx.user.update({ where: { id: me.id }, data: { xp: { increment: xp } } });
        if (won) await notify(tx, ch.userId, 'challenge', `<b>${esc(me.name)}</b> beat your <b>${esc(gameMeta(game).name)}</b> challenge with ${fmt(score)}.`, now);
      }
      challenge = { won, opponent: owner?.name ?? '', target: ch.score };
      badges.push(won ? 'challenge_won' : 'challenge_lost');
      rows = [{ name: me.name, score, me: true }, { name: owner?.name ?? '', score: ch.score, me: false }]
        .sort((a, b) => b.score - a.score || Number(a.me) - Number(b.me))
        .map((p, i) => ({ place: i + 1, ...p }));
    }
  } else badges.push('not_recorded');

  const missionsCompleted: MissionId[] = await trackRun(tx, me.id, dayNum(now), { game, mode, newBest, duelWin, challengeWin, seconds }, now);
  return {
    runId, status: 'finished', game, mode, score, place, newBest, xpGained: xp, boxDropped, badges, prizeIfHeld, rewardsHeld: false,
    ...(duel ? { duel } : {}), ...(challenge ? { challenge } : {}), top5: rows, user: await userView(), missionsCompleted,
  };
}

// ---------------------------------------------------------------- review of flagged runs (operators)
/**
 * Approves a flagged run: it is settled exactly as an accepted run would have been (board, XP, box
 * roll, missions), at the time of approval. The conditional update (flagged → finished) makes this
 * happen at most once per run. A duel that was forfeited when the run was flagged stays forfeited.
 */
export async function approveFlaggedRun(ctx: Ctx, tx: Tx, runId: string): Promise<{ result: FinishRunResponse; after: After }> {
  const now = ctx.clock.now();
  const pre = await tx.run.findUnique({ where: { id: runId } });
  if (!pre) throw notFound('No such run.');
  await lockUser(tx, pre.userId);
  const claimed = await tx.run.updateMany({ where: { id: runId, status: 'flagged' }, data: { status: 'finished', rewardsHeld: false } });
  if (claimed.count === 0) throw conflict('That run is not waiting for review.');
  const run: Run = { ...pre, status: 'finished', rewardsHeld: false };
  const after: After[] = [];
  const result = await creditAccepted(ctx, tx, run, pre.score ?? 0, (pre.frames ?? 0) / 60, now, after);
  // A later finish of the same run (the player's client retrying) now gets the approved answer.
  const body = result as unknown as object;
  await tx.idempotency.upsert({ where: { key: runResultKey(runId) }, create: { key: runResultKey(runId), status: 200, body, createdAt: now }, update: { status: 200, body } });
  return { result, after: async () => { for (const a of after) await a(); } };
}

/** Rejects a flagged run: nothing is paid and the entry is not refunded. */
export async function rejectFlaggedRun(ctx: Ctx, tx: Tx, runId: string): Promise<void> {
  const pre = await tx.run.findUnique({ where: { id: runId } });
  if (!pre) throw notFound('No such run.');
  const reason = `rejected after review${pre.reason ? ` (${pre.reason})` : ''}`.slice(0, 500);
  const claimed = await tx.run.updateMany({ where: { id: runId, status: 'flagged' }, data: { status: 'rejected', rewardsHeld: false, reason } });
  if (claimed.count === 0) throw conflict('That run is not waiting for review.');
  const body = new AppError(422, 'run_rejected', reason).body() as unknown as object;
  await tx.idempotency.upsert({ where: { key: runResultKey(runId) }, create: { key: runResultKey(runId), status: 422, body, createdAt: ctx.clock.now() }, update: { status: 422, body } });
}

/** The stored answer of a run that is no longer open, or null. */
export async function storedResult(ctx: Ctx, runId: string): Promise<Handled<FinishRunResponse | ApiError> | null> {
  const row = await ctx.db.idempotency.findUnique({ where: { key: runResultKey(runId) } });
  return row ? { status: row.status, body: row.body as unknown as FinishRunResponse | ApiError } : null;
}

/** Judges a client finish. The replay runs before the transaction so the transaction stays short. */
export async function prepareFinish(ctx: Ctx, run: Run, body: FinishRunRequest): Promise<{ input: RunInput; verdict: Verdict; streamedTo: number }> {
  const stream = await ctx.stream.snapshot(run.id);
  const input: RunInput = { frames: body.frames, log: body.inputLog, clientScore: body.score };
  return { input, verdict: judge(run, input, ctx.clock.now(), stream, ctx.cfg.requireStream), streamedTo: stream?.to ?? 0 };
}

export const isAlreadySettled = (e: unknown): boolean => e instanceof AlreadySettled;

/**
 * Ends a run from the server side (the stream stopped, stalled or cheated). A stalled run is scored
 * from the inputs received so far; a cheating stream rejects the run.
 */
export async function endRunFromStream(ctx: Ctx, runId: string, how: { reject: string } | { ended: string }, snap: StreamSnapshot): Promise<void> {
  const run = await ctx.db.run.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'open') return;
  const log = snap.events.slice(0, firstAtOrAfter(snap.events, snap.to));
  const input: RunInput = { frames: snap.to, log, clientScore: null, serverEnded: 'ended' in how ? how.ended : how.reject };
  const verdict: Verdict = 'reject' in how ? { kind: 'reject', reason: how.reject } : judge(run, input, ctx.clock.now(), snap, false);
  try {
    const res = await ctx.db.$transaction((tx) => settleRun(ctx, tx, runId, input, verdict, snap.to), TX);
    await res.after?.();
  } catch (e) {
    if (!isAlreadySettled(e)) throw e;
  }
}

/** Index of the first log entry whose frame is >= `frame` (events at the cut-off frame were never simulated). */
function firstAtOrAfter(log: number[], frame: number): number {
  let i = 0;
  while (i < log.length && log[i]! < frame) i += 3;
  return i;
}

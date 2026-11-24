// Operator tools under /api/admin. An operator is an account whose email or wallet is listed in
// ADMIN_EMAILS / ADMIN_WALLETS; there is no other way in. Every mutation is idempotent (Idempotency-Key)
// and written to the AdminAction audit table in the same transaction. CSRF and rate limits apply as
// on every other route (global hooks).
import { pressStats } from '@podium/games';
import {
  dayNum, levelOf,
  type AdminActionItem, type AdminOverviewResponse, type AdminRunActionResponse, type AdminRunRow, type AdminRunsResponse, type AdminUserActionResponse,
  type AdminUserDetail, type AdminUserRow, type AdminUsersResponse, type GameKey, type RunMode, type RunStatus,
} from '@podium/shared';
import type { Prisma, Run, User } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx, Tx } from '../ctx';
import { conflict, forbidden, notFound } from '../errors';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requireUser } from '../plugins/session';
import { feesKey, lockUser, readCounter } from '../services/ledger';
import { allWeeklyPeriods, cupPeriod } from '../services/periods';
import { approveFlaggedRun, rejectFlaggedRun } from '../services/runs';
import { setFlagged } from '../services/users';
import { parse } from './_util';

const PAGE = 25;
const DAY_MS = 86_400_000;

export const isAdmin = (ctx: Ctx, u: Pick<User, 'guest' | 'email' | 'wallet'>): boolean =>
  !u.guest && ((!!u.email && ctx.cfg.adminEmails.includes(u.email.toLowerCase())) || (!!u.wallet && ctx.cfg.adminWallets.includes(u.wallet)));

/** 401 without an account, 403 for anyone who is not listed as an operator. */
function requireAdmin(ctx: Ctx, req: FastifyRequest): User {
  const u = requireUser(req);
  if (!isAdmin(ctx, u)) throw forbidden('Not available.');
  return u;
}

const noteSchema = z.object({ note: z.string().trim().max(500).optional() });
const flagSchema = z.object({ flagged: z.boolean(), note: z.string().trim().max(500).optional() });
const idParam = (req: FastifyRequest): string => parse(z.object({ id: z.string().min(1).max(40) }), req.params).id;

type RunRowSource = Pick<Run, 'id' | 'userId' | 'game' | 'mode' | 'status' | 'score' | 'clientScore' | 'reason' | 'frames' | 'createdAt' | 'finishedAt' | 'inputLog'> & { user: { name: string } };
const runSelect = {
  id: true, userId: true, game: true, mode: true, status: true, score: true, clientScore: true, reason: true, frames: true, createdAt: true, finishedAt: true, inputLog: true,
  user: { select: { name: true } },
} as const satisfies Prisma.RunSelect;

function runRow(r: RunRowSource): AdminRunRow {
  let press: AdminRunRow['press'] = null;
  if (r.inputLog) {
    try {
      const log = JSON.parse(Buffer.from(r.inputLog).toString('utf8')) as unknown;
      if (Array.isArray(log)) {
        const p = pressStats(log as number[]);
        press = { presses: p.presses, peakPerSecond: p.peakPerSecond, intervalCv: Math.round(p.intervalCv * 1000) / 1000 };
      }
    } catch {
      /* an unreadable log shows as no stats */
    }
  }
  return {
    id: r.id, user: { id: r.userId, name: r.user.name }, game: r.game as GameKey, mode: r.mode as RunMode, status: r.status as RunStatus,
    score: r.score, clientScore: r.clientScore, reason: r.reason, frames: r.frames,
    createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, press,
  };
}

const userRow = (u: User): AdminUserRow => ({
  id: u.id, name: u.name, email: u.email, wallet: u.wallet, guest: u.guest, flagged: u.flagged, chainHold: u.chainHold, balance: u.balance,
  createdAt: u.createdAt.toISOString(),
});

async function audit(ctx: Ctx, tx: Tx, adminId: string, action: string, t: { userId?: string | null; runId?: string | null; note?: string }): Promise<void> {
  await tx.adminAction.create({
    data: { adminId, action, targetUserId: t.userId ?? null, targetRunId: t.runId ?? null, note: t.note || null, createdAt: ctx.clock.now() },
  });
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/admin/overview', async (req): Promise<AdminOverviewResponse> => {
    requireAdmin(ctx, req);
    const now = ctx.clock.now();
    const dayStart = new Date(dayNum(now) * DAY_MS);
    const [users, signedInUsers, runsToday, flaggedPending, rejectedToday, openDuels, feesToday, periods, cup] = await Promise.all([
      ctx.db.user.count(),
      ctx.db.user.count({ where: { guest: false } }),
      ctx.db.run.count({ where: { createdAt: { gte: dayStart } } }),
      ctx.db.run.count({ where: { status: 'flagged' } }),
      ctx.db.run.count({ where: { status: 'rejected', createdAt: { gte: dayStart } } }),
      ctx.db.duel.count({ where: { status: { in: ['waiting', 'matched'] } } }),
      readCounter(ctx.db, feesKey(now)),
      allWeeklyPeriods(ctx.db, now, ctx),
      cupPeriod(ctx.db, now, ctx),
    ]);
    const chain = ctx.chain
      ? {
          pendingOps: await ctx.db.chainOp.count({ where: { status: { in: ['pending', 'sent'] } } }),
          failedOps: await ctx.db.chainOp.count({ where: { status: 'failed' } }),
          holds: await ctx.db.user.count({ where: { chainHold: true } }),
        }
      : null;
    return {
      users, signedInUsers, runsToday, flaggedPending, rejectedToday, openDuels, feesToday,
      pools: periods.map((p) => ({ game: p.game as GameKey, pool: p.pool, endsAt: p.endAt.toISOString() })),
      cup: { game: cup.game as GameKey, pool: cup.pool, endsAt: cup.endAt.toISOString() },
      chain,
    };
  });

  app.get('/admin/runs', async (req): Promise<AdminRunsResponse> => {
    requireAdmin(ctx, req);
    const q = parse(z.object({ status: z.enum(['flagged', 'rejected']).default('flagged'), cursor: z.string().min(1).max(40).optional() }), req.query);
    const rows = await ctx.db.run.findMany({
      where: { status: q.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: runSelect,
    });
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    return { runs: page.map(runRow), next: more ? page[page.length - 1]!.id : null };
  });

  app.post('/admin/runs/:id/approve', async (req, reply) => {
    const admin = requireAdmin(ctx, req);
    const id = idParam(req);
    const body = parse(noteSchema, req.body);
    return idempotent<AdminRunActionResponse>(ctx, reply, admin.id, `admin.approve:${id}`, idemKey(req), async (tx) => {
      const { after } = await approveFlaggedRun(ctx, tx, id);
      const run = await tx.run.findUniqueOrThrow({ where: { id }, select: runSelect });
      await audit(ctx, tx, admin.id, 'run.approve', { userId: run.userId, runId: id, note: body.note });
      return { status: 200, body: { ok: true, run: runRow(run) }, after };
    });
  });

  app.post('/admin/runs/:id/reject', async (req, reply) => {
    const admin = requireAdmin(ctx, req);
    const id = idParam(req);
    const body = parse(noteSchema, req.body);
    return idempotent<AdminRunActionResponse>(ctx, reply, admin.id, `admin.reject:${id}`, idemKey(req), async (tx) => {
      await rejectFlaggedRun(ctx, tx, id);
      const run = await tx.run.findUniqueOrThrow({ where: { id }, select: runSelect });
      await audit(ctx, tx, admin.id, 'run.reject', { userId: run.userId, runId: id, note: body.note });
      return { status: 200, body: { ok: true, run: runRow(run) } };
    });
  });

  app.get('/admin/users', async (req): Promise<AdminUsersResponse> => {
    requireAdmin(ctx, req);
    const { q } = parse(z.object({ q: z.string().trim().max(100).default('') }), req.query);
    const where: Prisma.UserWhereInput = q
      ? { OR: [{ id: q }, { name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { wallet: { contains: q } }] }
      : {};
    const users = await ctx.db.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 });
    return { users: users.map(userRow) };
  });

  app.get('/admin/users/:id', async (req): Promise<AdminUserDetail> => {
    requireAdmin(ctx, req);
    const id = idParam(req);
    const u = await ctx.db.user.findUnique({ where: { id } });
    if (!u) throw notFound('No such user.');
    const [ledger, runs, actions] = await Promise.all([
      ctx.db.ledger.findMany({ where: { userId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
      ctx.db.run.findMany({ where: { userId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: runSelect }),
      ctx.db.adminAction.findMany({ where: { targetUserId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const adminNames = new Map(
      (await ctx.db.user.findMany({ where: { id: { in: [...new Set(actions.map((a) => a.adminId))] } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]),
    );
    return {
      ...userRow(u),
      adult: u.adult, xp: u.xp, level: levelOf(u.xp), avatar: u.avatar, frame: u.frame, googleLinked: !!u.googleId,
      stats: { plays: u.plays, spent: u.spent, won: u.won, duelsWon: u.duelsWon, duelsLost: u.duelsLost },
      validatedRanked: u.validatedRanked, lastIp: u.lastIp,
      ledger: ledger.map((l) => ({ id: l.id, createdAt: l.createdAt.toISOString(), amount: l.amount, reason: l.reason, ref: l.ref })),
      runs: runs.map(runRow),
      actions: actions.map((a): AdminActionItem => ({
        id: a.id, createdAt: a.createdAt.toISOString(), admin: adminNames.get(a.adminId) ?? a.adminId, action: a.action,
        targetUserId: a.targetUserId, targetRunId: a.targetRunId, note: a.note,
      })),
    };
  });

  // Flag or unflag an account. Goes through setFlagged so that, in chain mode, the wallet is frozen
  // (or unfrozen) on-chain as well; it runs inside this request's transaction.
  app.post('/admin/users/:id/flag', async (req, reply) => {
    const admin = requireAdmin(ctx, req);
    const id = idParam(req);
    const body = parse(flagSchema, req.body);
    return idempotent<AdminUserActionResponse>(ctx, reply, admin.id, `admin.flag:${id}`, idemKey(req), async (tx) => {
      if (!(await tx.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound('No such user.');
      await lockUser(tx, id);
      const u = await setFlagged(ctx, id, body.flagged, tx);
      await audit(ctx, tx, admin.id, body.flagged ? 'user.flag' : 'user.unflag', { userId: id, note: body.note });
      return { status: 200, body: { ok: true, user: userRow(u) } };
    });
  });

  // Chain mode only: release a player held because one of their on-chain operations was rejected.
  app.post('/admin/users/:id/clear-hold', async (req, reply) => {
    const admin = requireAdmin(ctx, req);
    const id = idParam(req);
    const body = parse(noteSchema, req.body);
    if (!ctx.chain) throw conflict('Holds exist only while chain mode is on.');
    return idempotent<AdminUserActionResponse>(ctx, reply, admin.id, `admin.clear_hold:${id}`, idemKey(req), async (tx) => {
      if (!(await tx.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound('No such user.');
      await lockUser(tx, id);
      const u = await tx.user.update({ where: { id }, data: { chainHold: false } });
      await audit(ctx, tx, admin.id, 'user.clear_hold', { userId: id, note: body.note });
      return { status: 200, body: { ok: true, user: userRow(u) } };
    });
  });
}

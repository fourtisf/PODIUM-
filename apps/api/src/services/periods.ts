// Weekly boards (Friday to Friday UTC) and the Cup (Monday to Monday UTC). Rows are created lazily.
// In chain mode a new Period row also queues create_pool for the on-chain pool, in the same transaction.
import { GAME_KEYS, cupGame, cupStart, periodEnd, weeklyStart, type GameKey } from '@podium/shared';
import type { Period } from '@prisma/client';
import { enqueueCreatePool } from '../chain/outbox';
import type { Ctx, Tx } from '../ctx';

export type PeriodKind = 'weekly' | 'cup';

/** Runs `fn` in a transaction: the caller's own, or a new one when `db` is the plain client. */
function inTx<T>(db: Tx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const root = db as Tx & { $transaction?: (f: (tx: Tx) => Promise<T>) => Promise<T> };
  return typeof root.$transaction === 'function' ? root.$transaction(fn) : fn(db);
}

/** Creates the missing rows and, in chain mode, queues their on-chain pools together with them. */
async function create(ctx: Ctx | undefined, db: Tx, rows: { kind: PeriodKind; game: string; startAt: Date }[]): Promise<void> {
  const data = rows.map((r) => ({ ...r, endAt: periodEnd(r.startAt) }));
  if (!ctx?.chain) {
    await db.period.createMany({ data, skipDuplicates: true });
    return;
  }
  await inTx(db, async (tx) => {
    for (const p of await tx.period.createManyAndReturn({ data, skipDuplicates: true })) await enqueueCreatePool(ctx, tx, p);
  });
}

async function ensure(ctx: Ctx | undefined, db: Tx, kind: PeriodKind, game: GameKey, startAt: Date): Promise<Period> {
  const where = { kind_game_startAt: { kind, game, startAt } };
  const found = await db.period.findUnique({ where });
  if (found) return found;
  await create(ctx, db, [{ kind, game, startAt }]);
  return db.period.findUniqueOrThrow({ where });
}

// `ctx` is what lets a new row queue its on-chain pool: every caller in src passes it.
export const weeklyPeriod = (db: Tx, game: GameKey, now: Date, ctx?: Ctx): Promise<Period> => ensure(ctx, db, 'weekly', game, weeklyStart(now));
export const cupPeriod = (db: Tx, now: Date, ctx?: Ctx): Promise<Period> => ensure(ctx, db, 'cup', cupGame(now), cupStart(now));

/** The current weekly period of every game, in GAME_KEYS order. */
export async function allWeeklyPeriods(db: Tx, now: Date, ctx?: Ctx): Promise<Period[]> {
  const startAt = weeklyStart(now);
  let rows = await db.period.findMany({ where: { kind: 'weekly', startAt } });
  if (rows.length < GAME_KEYS.length) {
    await create(ctx, db, GAME_KEYS.map((game) => ({ kind: 'weekly' as const, game, startAt })));
    rows = await db.period.findMany({ where: { kind: 'weekly', startAt } });
  }
  const by = new Map(rows.map((r) => [r.game, r]));
  return GAME_KEYS.map((k) => by.get(k)!).filter(Boolean);
}

/** Makes sure the period that follows a closed one exists. */
export async function ensureNext(db: Tx, closed: Period, ctx?: Ctx): Promise<void> {
  if (closed.kind === 'cup') await ensure(ctx, db, 'cup', cupGame(closed.endAt), closed.endAt);
  else await ensure(ctx, db, 'weekly', closed.game as GameKey, closed.endAt);
}

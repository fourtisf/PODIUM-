// Weekly boards (Friday to Friday UTC) and the Cup (Monday to Monday UTC). Rows are created lazily.
import { GAME_KEYS, cupGame, cupStart, periodEnd, weeklyStart, type GameKey } from '@podium/shared';
import type { Period } from '@prisma/client';
import type { Tx } from '../ctx';

export type PeriodKind = 'weekly' | 'cup';

async function ensure(db: Tx, kind: PeriodKind, game: GameKey, startAt: Date): Promise<Period> {
  const where = { kind_game_startAt: { kind, game, startAt } };
  const found = await db.period.findUnique({ where });
  if (found) return found;
  await db.period.createMany({ data: [{ kind, game, startAt, endAt: periodEnd(startAt) }], skipDuplicates: true });
  return db.period.findUniqueOrThrow({ where });
}

export const weeklyPeriod = (db: Tx, game: GameKey, now: Date): Promise<Period> => ensure(db, 'weekly', game, weeklyStart(now));
export const cupPeriod = (db: Tx, now: Date): Promise<Period> => ensure(db, 'cup', cupGame(now), cupStart(now));

/** The current weekly period of every game, in GAME_KEYS order. */
export async function allWeeklyPeriods(db: Tx, now: Date): Promise<Period[]> {
  const startAt = weeklyStart(now);
  let rows = await db.period.findMany({ where: { kind: 'weekly', startAt } });
  if (rows.length < GAME_KEYS.length) {
    await db.period.createMany({ data: GAME_KEYS.map((game) => ({ kind: 'weekly', game, startAt, endAt: periodEnd(startAt) })), skipDuplicates: true });
    rows = await db.period.findMany({ where: { kind: 'weekly', startAt } });
  }
  const by = new Map(rows.map((r) => [r.game, r]));
  return GAME_KEYS.map((k) => by.get(k)!).filter(Boolean);
}

/** Makes sure the period that follows a closed one exists. */
export async function ensureNext(db: Tx, closed: Period): Promise<void> {
  if (closed.kind === 'cup') await ensure(db, 'cup', cupGame(closed.endAt), closed.endAt);
  else await ensure(db, 'weekly', closed.game as GameKey, closed.endAt);
}

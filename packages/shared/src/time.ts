// All periods are in UTC. Weekly boards run Friday 00:00 to Friday 00:00; the Cup runs Monday to Monday.
import { CUP_GAMES } from './economy';
import type { GameKey } from './games';

const DAY = 86_400_000;

/** Days since 1970-01-01 UTC. Day 0 was a Thursday. */
export const dayNum = (now: Date | number = Date.now()): number => Math.floor(+now / DAY);

/** Start of the weekly board period containing `now` (most recent Friday 00:00 UTC). */
export function weeklyStart(now: Date | number = Date.now()): Date {
  const d = dayNum(now);
  // (d + 4) % 7 is the weekday with Sunday = 0; Friday = 5.
  const sinceFriday = (((d + 4) % 7) - 5 + 7) % 7;
  return new Date((d - sinceFriday) * DAY);
}

/** Start of the Cup week containing `now` (most recent Monday 00:00 UTC). */
export function cupStart(now: Date | number = Date.now()): Date {
  const d = dayNum(now);
  const sinceMonday = (((d + 4) % 7) - 1 + 7) % 7;
  return new Date((d - sinceMonday) * DAY);
}

export const periodEnd = (start: Date): Date => new Date(+start + 7 * DAY);

/** Cup week index, as in the prototype: floor((dayNum + 3) / 7). */
export const cupWeek = (now: Date | number = Date.now()): number => Math.floor((dayNum(now) + 3) / 7);
export const cupGame = (now: Date | number = Date.now()): GameKey => CUP_GAMES[cupWeek(now) % CUP_GAMES.length]!;

/** ISO-like week key used to cap inviter rewards, e.g. "w2931". */
export const weekKey = (now: Date | number = Date.now()): string => 'w' + cupWeek(now);

export function countdown(to: Date | number, now: Date | number = Date.now()): { d: number; h: number; m: number } {
  const s = Math.max(0, Math.floor((+to - +now) / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s / 3600) % 24), m: Math.floor((s / 60) % 60) };
}

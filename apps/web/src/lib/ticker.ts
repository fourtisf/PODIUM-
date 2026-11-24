// Activity ticker rules (Chrome.tsx). Real events only, and never made to look busier than it is.
import type { ActivityItem } from '@podium/shared';

/** Below this many distinct events the ticker is a static row: a marquee would have to repeat them. */
export const MARQUEE_MIN = 6;
/** At most this many events are shown. */
export const TICKER_MAX = 12;

const same = (a: ActivityItem, b: ActivityItem): boolean => a.name === b.name && a.text === b.text && a.game === b.game;

/** Drops each event that repeats the one before it (the same player scoring the same game again). */
export function dedupeActivity(items: ActivityItem[]): ActivityItem[] {
  return items.filter((f, i) => i === 0 || !same(f, items[i - 1]!)).slice(0, TICKER_MAX);
}

/** Whether to scroll: enough distinct events, and one copy of them at least as wide as the bar. */
export const tickerScrolls = (distinct: number, oneCopyWidth: number, barWidth: number): boolean =>
  distinct >= MARQUEE_MIN && barWidth > 0 && oneCopyWidth >= barWidth;

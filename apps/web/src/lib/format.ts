// Small display helpers shared by the pages.
import { FRAMES, PREMIUM_AVATARS, countdown, isFrameKey, type SeasonReward } from '@podium/shared';

/** "3 days 10 hours", as on the home page. */
export const endsLong = (to: string | number | Date, now: number): string => {
  const e = countdown(new Date(to), now);
  return `${e.d} days ${e.h} hours`;
};
/** "3d 10h 5m", as on the leaderboard. */
export const endsShort = (to: string | number | Date, now: number): string => {
  const e = countdown(new Date(to), now);
  return `${e.d}d ${e.h}h ${e.m}m`;
};
/** "6d 10h", as on the Cup banner. */
export const endsCup = (to: string | number | Date, now: number): string => {
  const e = countdown(new Date(to), now);
  return `${e.d}d ${e.h}h`;
};

export const frameCss = (frame: string): string => (isFrameKey(frame) ? FRAMES[frame].css : 'transparent');

export const tierName = (r: SeasonReward): string =>
  r.kind === 'chips' ? `${r.amount} tChips` : r.kind === 'box' ? 'Mystery box' : r.kind === 'frame' ? FRAMES[r.frame].name : `${PREMIUM_AVATARS[r.avatar]?.name ?? 'Rare'} avatar`;

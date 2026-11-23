// Season 1 track, from the prototype's SEASON array. Thresholds are total XP.
import type { FrameKey } from './economy';

export const SEASON_NUMBER = 1;

export type SeasonReward =
  | { kind: 'chips'; amount: number }
  | { kind: 'box' }
  | { kind: 'frame'; frame: FrameKey }
  | { kind: 'avatar'; avatar: number };

export interface SeasonTier {
  xp: number;
  reward: SeasonReward;
}

export const SEASON: SeasonTier[] = [
  { xp: 200, reward: { kind: 'chips', amount: 150 } },
  { xp: 400, reward: { kind: 'box' } },
  { xp: 700, reward: { kind: 'chips', amount: 250 } },
  { xp: 1000, reward: { kind: 'frame', frame: 'mint' } },
  { xp: 1400, reward: { kind: 'chips', amount: 400 } },
  { xp: 1800, reward: { kind: 'box' } },
  { xp: 2300, reward: { kind: 'chips', amount: 600 } },
  { xp: 2800, reward: { kind: 'avatar', avatar: 13 } },
  { xp: 3400, reward: { kind: 'chips', amount: 800 } },
  { xp: 4000, reward: { kind: 'frame', frame: 'aurora' } },
];

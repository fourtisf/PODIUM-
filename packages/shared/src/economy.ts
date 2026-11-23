// Every economy number, from HANDOFF.md section 4 and the prototype's CFG, STREAK, PREM, FRAMES,
// CUPSPLIT and box code. All amounts are whole tChips. tChips have no value.
// Do not hard-code any of these elsewhere; ask the owner before changing one.
import type { GameKey } from './games';

export const ECONOMY = {
  startBalance: 2000,
  startBoxes: 1,
  freePracticeRuns: 3,
  refillTo: 500,
  refillUnder: 100,
  rankedEntry: 100,
  practiceEntry: 10,
  cupEntry: 250,
  fee: 0.06,
  weeklySplit: [0.5, 0.3, 0.2],
  cupSplit: [0.4, 0.25, 0.15, 0.12, 0.08],
  duelStakes: [50, 100, 250, 500],
  duelExpiryHours: 24,
  shopBurn: 0.1,
  boxDropChance: 0.05,
  boxPrice: 300,
  /** Paid instead of a season cosmetic the player already owns. */
  ownedCosmeticFallback: 300,
} as const;

export type DuelStake = (typeof ECONOMY.duelStakes)[number];
export const isDuelStake = (n: unknown): n is DuelStake => (ECONOMY.duelStakes as readonly number[]).includes(n as number);

/** What the winner of a duel receives: both stakes minus the fee. */
export const duelPayout = (stake: number): number => Math.round(stake * 2 * (1 - ECONOMY.fee));
export const duelFee = (stake: number): number => stake * 2 - duelPayout(stake);

/** Fee and per-place payouts for a closed pool. Rounding matches the prototype (round each share). */
export function splitPool(pool: number, split: readonly number[], winners: number): { fee: number; payouts: number[] } {
  const fee = Math.round(pool * ECONOMY.fee);
  const pay = pool - fee;
  const payouts = split.slice(0, winners).map((s) => Math.round(pay * s));
  // Never pay out more than the pool holds.
  let over = payouts.reduce((a, b) => a + b, 0) - pay;
  for (let i = payouts.length - 1; i >= 0 && over > 0; i--) {
    const cut = Math.min(over, payouts[i]!);
    payouts[i]! -= cut;
    over -= cut;
  }
  return { fee, payouts };
}

/** Amount a place would win if the period closed now (shown on boards and the result screen). */
export const projectedPrize = (pool: number, split: readonly number[], place: number): number =>
  place >= 1 && place <= split.length ? Math.round(pool * (1 - ECONOMY.fee) * split[place - 1]!) : 0;

// ---------------------------------------------------------------- XP and levels
export const XP = {
  rankedRun: 40,
  cupRun: 60,
  /** A ranked or Cup run must last this long to earn run XP. */
  minRunSeconds: 10,
  personalBest: 60,
  duelWin: 50,
  duelLoss: 10,
  challengeWin: 80,
  challengeLoss: 15,
  weeklyTopThree: 150,
} as const;

export const levelOf = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
export const levelFloor = (level: number): number => (level - 1) ** 2 * 100;
export const levelCeil = (level: number): number => level ** 2 * 100;

// ---------------------------------------------------------------- daily streak
/** Day 7 also grants a mystery box. Missing a day resets to day 1. */
export const STREAK = [100, 150, 200, 250, 300, 400, 600] as const;
export const STREAK_BOX_INDEX = 6;

// ---------------------------------------------------------------- cosmetics
export const FREE_AVATARS = 12;
export const AVATAR_COUNT = 18;
/** Base colours of the twelve free avatars; premium avatars reuse them (id % 12). */
export const AVATAR_COLORS = ['#ff4f81', '#35d39c', '#ffc93a', '#8f83ff', '#4fb8f0', '#ff8a3c', '#2fc4b0', '#f06fc0', '#8fd44a', '#6c5cff', '#ffa63a', '#3fb890'] as const;

export const PREMIUM_AVATARS: Record<number, { name: string; price: number }> = {
  12: { name: 'Crown', price: 900 },
  13: { name: 'Visor', price: 900 },
  14: { name: 'Halo', price: 1200 },
  15: { name: 'Wizard', price: 1500 },
  16: { name: 'Headphones', price: 1500 },
  17: { name: 'Astronaut', price: 2500 },
};

export const FRAMES = {
  none: { name: 'No frame', css: 'transparent', price: 0 },
  mint: { name: 'Mint ring', css: '#35d39c', price: 500 },
  pink: { name: 'Pink ring', css: '#ff3d77', price: 500 },
  aurora: { name: 'Aurora ring', css: 'linear-gradient(135deg,#35d39c,#8f83ff,#ff3d77)', price: 2000 },
  fire: { name: 'Fire ring', css: 'linear-gradient(135deg,#ffc93a,#ff8a3c,#ff3d77)', price: 2000 },
} as const;
export type FrameKey = keyof typeof FRAMES;
export const isFrameKey = (k: unknown): k is FrameKey => typeof k === 'string' && Object.prototype.hasOwnProperty.call(FRAMES, k);
export const PAID_FRAMES = (Object.keys(FRAMES) as FrameKey[]).filter((k) => FRAMES[k].price > 0);

// ---------------------------------------------------------------- mystery box
export const BOX = {
  /** r < cosmetic: a cosmetic the player does not own (falls through to XP if none is left). */
  cosmetic: 0.16,
  /** r < xp: XP. Otherwise tChips. */
  xp: 0.42,
  /** Chance the cosmetic is an avatar when both kinds are still locked. */
  avatarShare: 0.6,
  xpMin: 80,
  xpMax: 200,
  chipsMin: 100,
  chipsMax: 400,
  step: 10,
} as const;

// ---------------------------------------------------------------- weekly Cup
export const CUP_GAMES: GameKey[] = ['blaster', 'hopper', 'breaker', 'traffic', 'cube'];
export const CUP_WINNERS = 5;
export const WEEKLY_WINNERS = 3;

// ---------------------------------------------------------------- referrals
export const REFERRAL = {
  invitedBonus: 300,
  inviterBonus: 300,
  /** Ranked runs the invited player must complete before the inviter is paid. */
  rankedRunsNeeded: 3,
  inviterWeeklyCap: 10,
} as const;

// ---------------------------------------------------------------- emissions
// Mission, streak, season and box tChips are paid from a capped daily budget, never minted on
// demand. The budget for a UTC day is a fixed base plus the fees collected the day before.
// HANDOFF.md gives no figure for the base; this one is a placeholder for the owner to set.
export const EMISSIONS = {
  dailyBase: 50_000,
  /** Below this share of the budget remaining, rewards are scaled down. */
  lowWater: 0.2,
  lowScale: 0.5,
} as const;

/** tChips actually paid for a reward of `amount`, given the day's budget and what is already spent. */
export function scaleEmission(amount: number, budget: number, spent: number): number {
  const left = Math.max(0, budget - spent);
  if (left <= 0 || amount <= 0) return 0;
  const scaled = left / budget < EMISSIONS.lowWater ? Math.floor(amount * EMISSIONS.lowScale) : amount;
  return Math.min(scaled, left);
}

// ---------------------------------------------------------------- Phase 2 anti-abuse
export const ANTI_ABUSE = {
  /** Mission, streak and referral rewards need this many validated ranked runs on the account. */
  minValidatedRuns: 3,
  /** The browser must send input at least this often during a run. */
  streamEveryMs: 2000,
  /** A run with no stream message for this long is ended. */
  streamTimeoutMs: 6000,
  /** Total time a run may be paused or behind real time before it is ended. */
  maxBehindMs: 30_000,
  /** Discrete inputs (presses) per second, averaged over the run and in any one second. */
  maxPressesPerSecond: 20,
  /** Runs with at least this many presses are checked for machine-regular timing. */
  regularityMinPresses: 30,
  /** Coefficient of variation of press intervals below this is flagged. */
  regularityCv: 0.03,
  /** Longest run the server accepts, in seconds. */
  maxRunSeconds: 3600,
  /** A run must be finished within this long of being started. */
  sessionSeconds: 2 * 3600,
} as const;

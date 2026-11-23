import { describe, expect, it } from 'vitest';
import {
  CUP_GAMES, ECONOMY, GAME_KEYS, MISSIONS, SEASON, cupGame, cupStart, dayNum, duelFee, duelPayout, levelOf,
  missionsForDay, periodEnd, projectedPrize, scaleEmission, splitPool, validateName, weeklyStart,
} from '../src';

describe('economy', () => {
  it('has thirteen games', () => expect(GAME_KEYS).toHaveLength(13));

  it('duel winner receives stake x 2 x 0.94', () => {
    expect(ECONOMY.duelStakes.map(duelPayout)).toEqual([94, 188, 470, 940]);
    expect(duelPayout(100) + duelFee(100)).toBe(200);
  });

  it('splits a weekly pool 50/30/20 after the 6% fee', () => {
    const { fee, payouts } = splitPool(1000, ECONOMY.weeklySplit, 3);
    expect(fee).toBe(60);
    expect(payouts).toEqual([470, 282, 188]);
    expect(projectedPrize(1000, ECONOMY.weeklySplit, 1)).toBe(470);
    expect(projectedPrize(1000, ECONOMY.weeklySplit, 4)).toBe(0);
  });

  it('never pays out more than the pool, whatever the rounding', () => {
    for (let pool = 0; pool < 3000; pool += 7) {
      for (const split of [ECONOMY.weeklySplit, ECONOMY.cupSplit]) {
        const { fee, payouts } = splitPool(pool, split, split.length);
        expect(fee + payouts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(pool);
        expect(payouts.every((p) => p >= 0)).toBe(true);
      }
    }
  });

  it('pays only the places that exist', () => expect(splitPool(1000, ECONOMY.cupSplit, 2).payouts).toEqual([376, 235]));

  it('levels follow floor(sqrt(xp / 100)) + 1', () => {
    expect([0, 99, 100, 399, 400, 4000].map(levelOf)).toEqual([1, 1, 2, 2, 3, 7]);
  });

  it('scales rewards down when the daily budget runs low and never overspends it', () => {
    expect(scaleEmission(200, 1000, 0)).toBe(200);
    expect(scaleEmission(200, 1000, 850)).toBe(100);
    expect(scaleEmission(200, 1000, 960)).toBe(40);
    expect(scaleEmission(200, 1000, 1000)).toBe(0);
  });
});

describe('missions and season', () => {
  it('picks three distinct missions a day', () => {
    for (let d = 0; d < 12; d++) expect(new Set(missionsForDay(d).map((m) => m.id)).size).toBe(3);
    expect(missionsForDay(0).map((m) => m.id)).toEqual([MISSIONS[0]!.id, MISSIONS[2]!.id, MISSIONS[4]!.id]);
  });
  it('season thresholds rise', () => expect(SEASON.map((t) => t.xp)).toEqual([...SEASON.map((t) => t.xp)].sort((a, b) => a - b)));
});

describe('time', () => {
  it('weekly boards start on Friday 00:00 UTC and the Cup on Monday', () => {
    const wed = new Date('2026-11-25T15:30:00Z');
    expect(weeklyStart(wed).toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(periodEnd(weeklyStart(wed)).toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(cupStart(wed).toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(weeklyStart(new Date('2026-11-27T00:00:00Z')).toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(dayNum(new Date('1970-01-02T00:00:00Z'))).toBe(1);
  });
  it('the Cup game is fixed within a week and rotates across weeks', () => {
    const mon = new Date('2026-11-23T00:00:00Z');
    expect(cupGame(mon)).toBe(cupGame(new Date('2026-11-29T23:59:59Z')));
    const seen = new Set([0, 1, 2, 3, 4].map((w) => cupGame(+mon + w * 7 * 86_400_000)));
    expect(seen.size).toBe(CUP_GAMES.length);
  });
});

describe('names', () => {
  it('applies the display-name rules', () => {
    expect(validateName('Rina_07')).toBeNull();
    expect(validateName('ab')).toBe('length');
    expect(validateName('Guest123')).toBe('reserved');
    expect(validateName('player one')).toBe('reserved');
    expect(validateName('bad<name>')).toBe('chars');
  });
});

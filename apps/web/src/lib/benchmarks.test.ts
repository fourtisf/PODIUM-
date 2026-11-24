import { BOT_LADDER, GAME_KEYS } from '@podium/shared';
import { describe, expect, it } from 'vitest';
import { BOTS_ON, botsFor, isBot, withBenchmarks, type BotRow } from './benchmarks';

const bot = (score: number, level = 1): BotRow => ({ bot: true, score, level, name: 'B' + level, avatar: level });
const ladder = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100].map((s, i) => bot(s, 10 - i));
const real = (place: number, score: number) => ({ place, score, name: 'P' + place, prize: place <= 3 ? 10 : 0 });

describe('bot benchmarks', () => {
  it('fills an empty board with ten bots, strongest first', () => {
    const rows = withBenchmarks([], ladder);
    expect(rows).toHaveLength(10);
    expect(rows.every(isBot)).toBe(true);
    expect(rows.map((r) => r.score)).toEqual([1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]);
  });

  it('keeps three real rows with their places and adds seven bots interleaved by score', () => {
    const r = [real(1, 950), real(2, 450), real(3, 50)];
    const rows = withBenchmarks(r, ladder);
    expect(rows).toHaveLength(10);
    expect(rows.filter((x) => !isBot(x))).toEqual(r);
    expect(rows.filter(isBot)).toHaveLength(7);
    expect(rows.map((x) => (isBot(x) ? 'b' : 'p') + x.score)).toEqual(['b1000', 'p950', 'b900', 'b800', 'b700', 'b600', 'b500', 'p450', 'b400', 'p50']);
    const scores = rows.map((x) => x.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('adds no bots when there are ten or more real rows', () => {
    const r = Array.from({ length: 12 }, (_, i) => real(i + 1, 2000 - i * 100));
    expect(withBenchmarks(r, ladder)).toEqual(r);
    expect(withBenchmarks(r.slice(0, 10), ladder)).toEqual(r.slice(0, 10));
  });

  it('puts a real player above a bot on the same score', () => {
    const rows = withBenchmarks([real(1, 700)], ladder);
    const i = rows.findIndex((x) => !isBot(x));
    expect(rows[i + 1]).toMatchObject({ bot: true, score: 700 });
    expect(rows[i - 1]).toMatchObject({ bot: true, score: 800 });
  });

  it('fills smaller lists (the home top three) the same way', () => {
    expect(withBenchmarks([], ladder, 3).map((x) => x.score)).toEqual([1000, 900, 800]);
    expect(withBenchmarks([real(1, 5)], ladder, 3).map((x) => x.score)).toEqual([1000, 900, 5]);
    expect(withBenchmarks([real(1, 5), real(2, 4), real(3, 3)], ladder, 3).every((x) => !isBot(x))).toBe(true);
  });

  it('shows no bots at all when the switch is off', () => {
    for (const k of GAME_KEYS) expect(botsFor(k, false)).toEqual([]);
    expect(withBenchmarks([], botsFor('snake', false))).toEqual([]);
    const r = [real(1, 950), real(2, 450)];
    expect(withBenchmarks(r, botsFor('snake', false))).toEqual(r);
  });

  it('is on unless NEXT_PUBLIC_BOT_BENCHMARKS is "off"', () => expect(BOTS_ON).toBe(process.env.NEXT_PUBLIC_BOT_BENCHMARKS !== 'off'));

  it('builds each game ladder from the shared constants', () => {
    for (const k of GAME_KEYS) {
      const b = botsFor(k);
      expect(b).toHaveLength(10);
      expect(b[0]!.level).toBe(10);
      expect(b.map((x) => x.score)).toEqual([...BOT_LADDER[k]].reverse());
    }
  });
});

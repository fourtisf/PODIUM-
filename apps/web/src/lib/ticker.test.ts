import type { ActivityItem } from '@podium/shared';
import { describe, expect, it } from 'vitest';
import { MARQUEE_MIN, dedupeActivity, tickerScrolls } from './ticker';

const ev = (name: string, game = 'Duck Dash', text = 'scored 100 in'): ActivityItem => ({ name, text, game, at: '2026-11-24T00:00:00Z' });

describe('ticker', () => {
  it('drops identical consecutive events only', () => {
    expect(dedupeActivity([ev('Ann'), ev('Ann'), ev('Ann')])).toEqual([ev('Ann')]);
    expect(dedupeActivity([ev('Ann'), ev('Bo'), ev('Ann')]).map((e) => e.name)).toEqual(['Ann', 'Bo', 'Ann']);
    expect(dedupeActivity([ev('Ann'), ev('Ann', 'Snake Turn')])).toHaveLength(2);
    expect(dedupeActivity(Array.from({ length: 30 }, (_, i) => ev('P' + i)))).toHaveLength(12);
  });
  it('scrolls only with enough events to fill the bar', () => {
    expect(tickerScrolls(1, 5000, 1280)).toBe(false);
    expect(tickerScrolls(MARQUEE_MIN - 1, 5000, 1280)).toBe(false);
    expect(tickerScrolls(MARQUEE_MIN, 1000, 1280)).toBe(false);
    expect(tickerScrolls(MARQUEE_MIN, 1300, 1280)).toBe(true);
    expect(tickerScrolls(MARQUEE_MIN, 1300, 0)).toBe(false);
  });
});

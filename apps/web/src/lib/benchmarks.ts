// Bot benchmark rows: DISPLAY ONLY. The leaderboard, the home cards and the play page add labelled bot rows
// (BOT_CAST on the BOT_LADDER scores from packages/shared, produced by scripts/bot-benchmarks.ts) under thin
// boards so there is always something to beat. Bot rows are never sent to the server, never ranked and never
// take a place or a prize: real rows keep exactly the places and prizes the API gave them.
import { BOT_CAST, BOT_LADDER } from '@podium/shared';
import type { BotChar, GameKey } from '@podium/shared';

/**
 * Build-time switch: NEXT_PUBLIC_BOT_BENCHMARKS=off hides every bot row, bot target and bot note.
 * Anything else (or unset) leaves them on. Next.js inlines it when the web app is built.
 */
export const BOTS_ON = process.env.NEXT_PUBLIC_BOT_BENCHMARKS !== 'off';

/** How many rows a board shows before bots stop filling it. */
export const BOARD_ROWS = 10;

export interface BotRow extends BotChar {
  bot: true;
  score: number;
}

export type WithBots<R> = (R & { bot?: undefined }) | BotRow;

/** The ten bots of a game's ladder, strongest first; none when the switch is off. */
export function botsFor(game: GameKey, on: boolean = BOTS_ON): BotRow[] {
  if (!on) return [];
  const ladder = BOT_LADDER[game];
  return BOT_CAST.map((c) => ({ ...c, bot: true as const, score: ladder[c.level - 1] ?? 0 })).sort((a, b) => b.score - a.score);
}

/**
 * Real rows plus just enough bot rows to reach `size` rows, sorted by score (best first).
 * Every real row is kept unchanged and in its own order; bots slot in by score and the lowest bots are
 * dropped first. On a tie the real player is above the bot. With `size` or more real rows there are no bots.
 */
export function withBenchmarks<R extends { score: number }>(real: readonly R[], bots: readonly BotRow[], size = BOARD_ROWS): WithBots<R>[] {
  const keep = Math.max(0, size - real.length);
  if (keep === 0) return real.slice() as WithBots<R>[];
  const out: WithBots<R>[] = [];
  const b = bots.slice().sort((x, y) => y.score - x.score);
  // Merge (real rows stay in the API's order, which is by score); then drop bots from the bottom.
  let i = 0, j = 0;
  while (i < real.length || j < b.length) {
    if (j >= b.length || (i < real.length && real[i]!.score >= b[j]!.score)) out.push(real[i++] as WithBots<R>);
    else out.push(b[j++]!);
  }
  let extra = out.length - Math.max(size, real.length);
  for (let k = out.length - 1; k >= 0 && extra > 0; k--) {
    if (out[k]!.bot) {
      out.splice(k, 1);
      extra--;
    }
  }
  return out;
}

export const isBot = <R>(r: WithBots<R>): r is BotRow => r.bot === true;

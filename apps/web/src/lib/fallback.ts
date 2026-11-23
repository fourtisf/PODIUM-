// Empty-but-valid page data for when the API cannot be reached, so pages still render.
import { ECONOMY, FEATURED_ORDER, GAME_KEYS, cupGame, cupStart, periodEnd, weeklyStart } from '@podium/shared';
import type { BoardResponse, CupResponse, GameKey, GamesResponse } from '@podium/shared';

export function emptyGames(now = new Date()): GamesResponse {
  const endsAt = periodEnd(weeklyStart(now)).toISOString();
  return {
    games: GAME_KEYS.map((key) => ({ key, pool: 0, endsAt, top3: [], myBest: null, plays: 0 })),
    hero: FEATURED_ORDER[0]!,
    serverTime: now.toISOString(),
  };
}

export function emptyBoard(game: GameKey, now = new Date()): BoardResponse {
  const start = weeklyStart(now);
  return { game, period: { startAt: start.toISOString(), endAt: periodEnd(start).toISOString() }, pool: 0, fee: 0, payouts: [], rows: [], me: null, beta: true };
}

export function emptyCup(now = new Date()): CupResponse {
  const start = cupStart(now);
  return { ...emptyBoard(cupGame(now), now), period: { startAt: start.toISOString(), endAt: periodEnd(start).toISOString() }, entry: ECONOMY.cupEntry };
}

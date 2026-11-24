// Server part of the home page: reads games, the Cup and (for a challenge link) the challenge
// from the API so the first paint has real content. Used by `/` and `/c/[code]`.
import type { ChallengeResponse, CupResponse, GamesResponse } from '@podium/shared';
import { isGameKey } from '@podium/shared';
import { emptyCup, emptyGames } from '@/lib/fallback';
import { serverGet } from '@/lib/server-api';
import { IdArea } from '@/i18n/IdArea';
import { HomeView } from './HomeView';

export const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;

export async function loadChallenge(code: string | undefined): Promise<ChallengeResponse | null> {
  if (!code || !CODE_RE.test(code)) return null;
  const c = await serverGet<ChallengeResponse>(`/challenges/${code}`, { anonymous: true });
  return c && isGameKey(c.game) ? c : null;
}

export async function HomeScreen({ challengeCode }: { challengeCode?: string }) {
  const [games, cup, challenge] = await Promise.all([serverGet<GamesResponse>('/games'), serverGet<CupResponse>('/cup'), loadChallenge(challengeCode)]);
  return (
    <IdArea areas={['home']}>
      <HomeView games={games && games.games.length ? games : emptyGames()} cup={cup ?? emptyCup()} challenge={challenge} />
    </IdArea>
  );
}

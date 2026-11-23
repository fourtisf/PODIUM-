// All thirteen games by key. Imported by the web app (to play) and the API (to replay).
import type { GameKey } from '@podium/shared';
import type { BaseState, GameDef } from './types';
import { blade } from './blade';
import { blaster } from './blaster';
import { breaker } from './breaker';
import { cube } from './cube';
import { duck } from './duck';
import { glide } from './glide';
import { hoop } from './hoop';
import { hop } from './hop';
import { hopper } from './hopper';
import { snake } from './snake';
import { sprint } from './sprint';
import { stack } from './stack';
import { traffic } from './traffic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_DEFS: Record<GameKey, GameDef<any>> = { traffic, duck, blade, glide, stack, hop, snake, sprint, hoop, cube, hopper, blaster, breaker };

export const gameDef = <S extends BaseState = BaseState>(k: GameKey): GameDef<S> => GAME_DEFS[k] as GameDef<S>;

/** Largest score the Phase 1 sanity check accepts for a run of this many seconds. */
export const maxPlausibleScore = (k: GameKey, seconds: number): number => {
  const d = GAME_DEFS[k];
  return Math.ceil(d.scoreSlack + d.maxScorePerSecond * Math.max(1, seconds));
};

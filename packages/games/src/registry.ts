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
import { bladeV1 } from './blade.v1';
import { cubeV1 } from './cube.v1';
import { duckV1 } from './duck.v1';
import { glideV1 } from './glide.v1';
import { hoopV1 } from './hoop.v1';
import { hopV1 } from './hop.v1';
import { hopperV1 } from './hopper.v1';
import { snakeV1 } from './snake.v1';
import { sprintV1 } from './sprint.v1';
import { trafficV1 } from './traffic.v1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_DEFS: Record<GameKey, GameDef<any>> = { traffic, duck, blade, glide, stack, hop, snake, sprint, hoop, cube, hopper, blaster, breaker };

export const gameDef = <S extends BaseState = BaseState>(k: GameKey): GameDef<S> => GAME_DEFS[k] as GameDef<S>;

/**
 * Older rule versions, kept so runs recorded on them replay exactly (the server's gameVersions.ts registers these).
 * When a game's rules change: copy its file to <key>.v<N>.ts, bump `version` in the live file and list the copy here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ARCHIVED_DEFS: Partial<Record<GameKey, GameDef<any>[]>> = {
  traffic: [trafficV1], duck: [duckV1], blade: [bladeV1], glide: [glideV1], hop: [hopV1], snake: [snakeV1], sprint: [sprintV1],
  hoop: [hoopV1], cube: [cubeV1], hopper: [hopperV1],
};

/** The rules of `k` at `version` (current or archived), or the current rules when that version is unknown. */
export const gameDefVersion = <S extends BaseState = BaseState>(k: GameKey, version?: number | null): GameDef<S> => {
  const cur = GAME_DEFS[k] as GameDef<S>;
  if (version == null || version === cur.version) return cur;
  return ((ARCHIVED_DEFS[k] ?? []).find((d) => d.version === version) as GameDef<S> | undefined) ?? cur;
};

/** Largest score the Phase 1 sanity check accepts for a run of this many seconds (on that rules version; current by default). */
export const maxPlausibleScore = (k: GameKey, seconds: number, version?: number): number => {
  const d = gameDefVersion(k, version);
  return Math.ceil(d.scoreSlack + d.maxScorePerSecond * Math.max(1, seconds));
};

// Rules are versioned: a run replays on the version it was played on. When a game's rules change, keep the
// old GameDef in packages/games (e.g. duck.v1.ts), bump `version` on the new one and register the old one in
// ARCHIVED_DEFS (packages/games/src/registry.ts), which is what ARCHIVED below reads, so the browser
// (gameDefVersion) and this replay always agree on the archived set.
// Version 2 (pacing: the first seconds start further along the difficulty curve) of traffic, duck, blade,
// glide, hop, snake, sprint, hoop, cube and hopper; their version 1 replays from <key>.v1.ts.
import { ARCHIVED_DEFS, GAME_DEFS, type BaseState, type GameDef } from '@podium/games';
import { GAME_KEYS, type GameKey } from '@podium/shared';

type AnyDef = GameDef<BaseState>;

const ARCHIVED: Partial<Record<GameKey, AnyDef[]>> = ARCHIVED_DEFS;

/** GAME_VERSIONS[key][version] → the rules to replay with. */
export const GAME_VERSIONS: Record<GameKey, Record<number, AnyDef>> = Object.fromEntries(
  GAME_KEYS.map((k) => {
    const current = GAME_DEFS[k] as AnyDef;
    const versions: Record<number, AnyDef> = {};
    for (const old of ARCHIVED[k] ?? []) versions[old.version] = old;
    versions[current.version] = current;
    return [k, versions];
  }),
) as Record<GameKey, Record<number, AnyDef>>;

export const currentVersion = (k: GameKey): number => (GAME_DEFS[k] as AnyDef).version;
export const versionDef = (k: GameKey, version: number): AnyDef | undefined => GAME_VERSIONS[k]?.[version];

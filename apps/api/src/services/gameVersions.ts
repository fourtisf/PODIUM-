// Rules are versioned: a run replays on the version it was played on. Today every game has only its
// current version. When a game's rules change, keep the old GameDef in packages/games (e.g.
// duck.v1.ts), bump `version` on the new one and register the old one in ARCHIVED below.
import { GAME_DEFS, type BaseState, type GameDef } from '@podium/games';
import { GAME_KEYS, type GameKey } from '@podium/shared';

type AnyDef = GameDef<BaseState>;

const ARCHIVED: Partial<Record<GameKey, AnyDef[]>> = {};

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

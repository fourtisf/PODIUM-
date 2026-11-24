// Rule versions: every game whose rules changed keeps its version 1 def, and both versions replay deterministically.
import { describe, expect, it } from 'vitest';
import { GAME_KEYS, type GameKey } from '@podium/shared';
import { ARCHIVED_DEFS, GAME_DEFS, gameDefVersion, maxPlausibleScore, replay, type GameDef } from '../src';
import { bladeV1 } from '../src/blade.v1';
import { cubeV1 } from '../src/cube.v1';
import { duckV1 } from '../src/duck.v1';
import { glideV1 } from '../src/glide.v1';
import { hoopV1 } from '../src/hoop.v1';
import { hopV1 } from '../src/hop.v1';
import { hopperV1 } from '../src/hopper.v1';
import { snakeV1 } from '../src/snake.v1';
import { sprintV1 } from '../src/sprint.v1';
import { trafficV1 } from '../src/traffic.v1';
import { checkDeterministic, scriptedLog } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V1: Record<'blade' | 'cube' | 'duck' | 'glide' | 'hoop' | 'hop' | 'hopper' | 'snake' | 'sprint' | 'traffic', GameDef<any>> = { blade: bladeV1, cube: cubeV1, duck: duckV1, glide: glideV1, hoop: hoopV1, hop: hopV1, hopper: hopperV1, snake: snakeV1, sprint: sprintV1, traffic: trafficV1 };
const CHANGED = Object.keys(V1) as (keyof typeof V1)[];

describe('rule versions', () => {
  it('the ten re-paced games are on version 2 and archive version 1; the other three are unchanged on version 1', () => {
    for (const k of GAME_KEYS) {
      if ((CHANGED as GameKey[]).includes(k)) {
        expect(GAME_DEFS[k].version).toBe(2);
        expect(ARCHIVED_DEFS[k]).toEqual([V1[k as keyof typeof V1]]);
      } else {
        expect(GAME_DEFS[k].version).toBe(1);
        expect(ARCHIVED_DEFS[k]).toBeUndefined();
      }
    }
  });

  for (const k of CHANGED) {
    describe(k, () => {
      it('gameDefVersion gives the archived rules for version 1 and the live rules for version 2', () => {
        const v1 = gameDefVersion(k, 1);
        expect(v1).toBe(V1[k]);
        expect(v1.version).toBe(1);
        expect(v1.key).toBe(k);
        expect(gameDefVersion(k, 2)).toBe(GAME_DEFS[k]);
        expect(gameDefVersion(k)).toBe(GAME_DEFS[k]);
        // An unknown version falls back to the live rules in the browser (the server rejects it instead).
        expect(gameDefVersion(k, 99)).toBe(GAME_DEFS[k]);
      });

      it('version 1 is still deterministic and within its own bound', () => checkDeterministic(V1[k], { seeds: [1, 20260501], frames: 60 * 60 }));

      it('the same seed and log can replay differently on version 1 and version 2', () => {
        let differ = 0;
        for (const seed of [1, 2, 3, 4, 5]) {
          const log = scriptedLog(seed * 7919, 60 * 40, 0.05);
          const a = replay(V1[k], seed, log, 60 * 40);
          const b = replay(GAME_DEFS[k], seed, log, 60 * 40);
          if (a.score !== b.score || a.frames !== b.frames) differ++;
        }
        expect(differ).toBeGreaterThan(0);
      });

      it('the sanity bound of version 2 is at least that of version 1', () => {
        expect(GAME_DEFS[k].maxScorePerSecond).toBeGreaterThanOrEqual(V1[k].maxScorePerSecond);
        expect(maxPlausibleScore(k, 30, 1)).toBe(Math.ceil(V1[k].scoreSlack + V1[k].maxScorePerSecond * 30));
        expect(maxPlausibleScore(k, 30, 2)).toBe(maxPlausibleScore(k, 30));
      });
    });
  }

  it('unchanged games answer version 1 with their live rules', () => {
    for (const k of ['stack', 'blaster', 'breaker'] as const) expect(gameDefVersion(k, 1)).toBe(GAME_DEFS[k]);
  });
});

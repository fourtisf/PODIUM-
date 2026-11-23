// Shared determinism checks. Each game's test file calls checkDeterministic(def).
import { expect, vi } from 'vitest';
import { Ev, replay, rnd, validateLog, type BaseState, type GameDef, type InputLog } from '../src';

/** A pseudo-random but reproducible input log: presses, holds and pointer drags. */
export function scriptedLog(seed: number, frames: number, density = 0.08): InputLog {
  const r = { seed };
  const log: InputLog = [];
  let l = false, rt = false, ptr = false;
  for (let f = 0; f < frames; f++) {
    if (rnd(r) < density) log.push(f, [Ev.PRESS_L, Ev.PRESS_R, Ev.PRESS_A][Math.floor(rnd(r) * 3)]!, 0);
    if (rnd(r) < density / 2) { l = !l; log.push(f, l ? Ev.L_DOWN : Ev.L_UP, 0); }
    if (rnd(r) < density / 2) { rt = !rt; log.push(f, rt ? Ev.R_DOWN : Ev.R_UP, 0); }
    if (rnd(r) < density / 4) { ptr = !ptr; log.push(f, ptr ? Ev.PTR_ON : Ev.PTR_OFF, Math.floor(rnd(r) * 481)); }
    else if (ptr && rnd(r) < 0.5) log.push(f, Ev.PTR_MOVE, Math.floor(rnd(r) * 481));
  }
  return log;
}

function finalState<S extends BaseState>(def: GameDef<S>, seed: number, log: InputLog, frames: number): string {
  // Same loop as replay(), but returns the whole state so hidden divergence is caught too.
  const s = def.init(seed);
  let i = 0;
  const held = { l: false, r: false, ptr: false, px: 240 };
  for (let f = 0; f < frames; f++) {
    const presses: ('l' | 'r' | 'a')[] = [];
    while (i < log.length && log[i]! <= f) {
      const c = log[i + 1]!, v = log[i + 2]!;
      if (c === Ev.L_DOWN) held.l = true; else if (c === Ev.L_UP) held.l = false;
      else if (c === Ev.R_DOWN) held.r = true; else if (c === Ev.R_UP) held.r = false;
      else if (c === Ev.PTR_ON) { held.ptr = true; held.px = v; } else if (c === Ev.PTR_MOVE) held.px = v; else if (c === Ev.PTR_OFF) held.ptr = false;
      else presses.push(c === Ev.PRESS_L ? 'l' : c === Ev.PRESS_R ? 'r' : 'a');
      i += 3;
    }
    s.fx.length = 0;
    if (def.update(s, { ...held, presses }, 1 / 60)) break;
  }
  s.fx.length = 0;
  return JSON.stringify(s);
}

/** Asserts: same seed and inputs give the same score and state; logic never calls Math.random, Date.now or performance.now. */
export function checkDeterministic<S extends BaseState>(def: GameDef<S>, opts: { seeds?: number[]; frames?: number } = {}): void {
  const seeds = opts.seeds ?? [1, 42, 20260501, -7];
  const frames = opts.frames ?? 60 * 90;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random() used in game logic'); });
  const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now() used in game logic'); });
  const perf = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('performance.now() used in game logic'); });
  try {
    const scores: number[] = [];
    for (const seed of seeds) {
      for (const density of [0, 0.03, 0.12]) {
        const log = scriptedLog(seed ^ 0x5bd1e995, frames, density);
        expect(validateLog(log, frames)).toBeNull();
        const a = replay(def, seed, log, frames);
        const b = replay(def, seed, log, frames);
        expect(b).toEqual(a);
        expect(Number.isInteger(a.score)).toBe(true);
        expect(a.score).toBeGreaterThanOrEqual(0);
        expect(finalState(def, seed, log, frames)).toBe(finalState(def, seed, log, frames));
        // The sanity bound must hold for every run the game can produce.
        expect(a.score).toBeLessThanOrEqual(def.scoreSlack + def.maxScorePerSecond * Math.max(1, a.seconds));
        scores.push(a.score);
      }
    }
    // State must survive a JSON round trip (the server may snapshot it).
    const s = def.init(seeds[0]!);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(scores.length).toBeGreaterThan(0);
  } finally {
    random.mockRestore();
    now.mockRestore();
    perf.mockRestore();
  }
}

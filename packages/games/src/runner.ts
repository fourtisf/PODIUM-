// Fixed-step runner used by the browser (LiveRun) and by the server and tests (replay).
import { InputTracker, type InputLog } from './log';
import { STEP, type BaseState, type Fx, type GameDef } from './types';

export interface ReplayResult {
  score: number;
  /** Steps actually simulated. */
  frames: number;
  /** The run ended inside the log (the player died). */
  dead: boolean;
  seconds: number;
}

/** Replays a log from a seed. Stops at death or after `frames` steps. */
export function replay<S extends BaseState>(def: GameDef<S>, seed: number, log: InputLog, frames: number): ReplayResult {
  const s = def.init(seed);
  const input = new InputTracker();
  let i = 0;
  let f = 0;
  let dead = false;
  for (; f < frames && !dead; f++) {
    while (i < log.length && log[i]! <= f) {
      input.apply(log[i + 1]!, log[i + 2]!);
      i += 3;
    }
    s.fx.length = 0;
    dead = def.update(s, input.take(), STEP);
  }
  return { score: Math.max(0, Math.floor(s.score || 0)), frames: f, dead, seconds: s.t };
}

/** A run in progress in the browser. The host feeds it events and calls step() from a 60 Hz accumulator. */
export class LiveRun<S extends BaseState = BaseState> {
  readonly state: S;
  readonly log: InputLog = [];
  frame = 0;
  dead = false;
  private input = new InputTracker();

  constructor(readonly def: GameDef<S>, readonly seed: number) {
    this.state = def.init(seed);
    this.state.fx.length = 0;
  }

  /** Records an input event; it takes effect on the next step. */
  push(code: number, value = 0): void {
    if (this.dead) return;
    const v = Math.max(0, Math.min(480, Math.round(value)));
    this.log.push(this.frame, code, v);
    this.input.apply(code, v);
  }

  /** Advances one fixed step and returns the side effects it queued. */
  step(): Fx[] {
    if (this.dead) return [];
    this.state.fx.length = 0;
    this.dead = this.def.update(this.state, this.input.take(), STEP);
    this.frame++;
    return this.state.fx;
  }

  get score(): number {
    return Math.max(0, Math.floor(this.state.score || 0));
  }
}

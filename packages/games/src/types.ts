// Contract every game in this package follows. Logic (init, update) is pure: it runs the same in
// the browser and in Node, takes a seed, advances in fixed 60 Hz steps and never touches the DOM,
// Date.now(), performance.now() or Math.random(). Only draw() may use a canvas.
import type { GameKey } from '@podium/shared';

/** Logical canvas size shared by all thirteen games. */
export const W = 480;
export const H = 640;
export const HZ = 60;
export const STEP = 1 / HZ;

/** A discrete press: left, right, or the action button (Space, Up, tap). */
export type Press = 'l' | 'r' | 'a';

/** Input for one fixed step. */
export interface Input {
  /** Left / right held (arrow keys or touch pad buttons). */
  l: boolean;
  r: boolean;
  /** Pointer is down on the stage. */
  ptr: boolean;
  /** Pointer x in logical pixels, 0..480. Only meaningful while `ptr` is true. */
  px: number;
  /** Presses that happened since the previous step, in order. */
  presses: Press[];
}

/** Visual and audio side effects. update() queues them on state.fx; the host plays them. They never affect logic. */
export type Fx =
  | { k: 'burst'; x: number; y: number; c: string; n: number; sp?: number }
  | { k: 'beep'; f: number; d: number; w?: 'sine' | 'square' | 'triangle' | 'sawtooth'; v?: number; slide?: number }
  | { k: 'text'; t: string };

export interface BaseState {
  score: number;
  /** Seconds of play so far. */
  t: number;
  /** Seeded generator state; advance it only through rnd() / R() from ./rng. */
  seed: number;
  /** Side effects queued during the current step. The runner clears it before every step. */
  fx: Fx[];
}

export interface DrawEnv {
  /** Draws the shared particle layer. Games with ownFx call it themselves at the right depth. */
  fxDraw(): void;
}

/** Display-only readouts of a state, for the host's HUD effects and side panel. Never part of the rules. */
export interface GameView {
  /** 0..1: how close the player is to losing (red vignette). */
  danger?: number;
  /** 0..1: how fast the run feels (speed lines). */
  speed?: number;
  /** Score multiplier; the host calls out "Combo xN" when it rises past 1. */
  mult?: number;
  /** Side-panel stats, in order. */
  stats?: { k: StatKey; v: number }[];
}
export type StatKey = 'combo' | 'level' | 'wave' | 'lives' | 'floors' | 'length' | 'gates' | 'streak' | 'speed';

export interface GameDef<S extends BaseState = BaseState> {
  key: GameKey;
  /** Rules version. Bump it whenever update() or init() changes behaviour; runs replay on the version they were played on. */
  version: number;
  /** Rendered with Three.js by the web app; draw() is absent. */
  gl?: boolean;
  /** Taps are split into thirds (left, action, right) instead of halves. */
  mid?: boolean;
  /** draw() paints the particle layer itself (through env.fxDraw). */
  ownFx?: boolean;
  /** Upper bound on score gained per second of play, derived from the game's constants. Used by the Phase 1 sanity check. */
  maxScorePerSecond: number;
  /** Score that can be reached regardless of duration (bonuses at the first frames). */
  scoreSlack: number;
  /** State is plain JSON-serialisable data. */
  init(seed: number): S;
  /** Advances one step. Returns true when the run is over. */
  update(s: S, input: Input, dt: number): boolean;
  /** 2D games only. */
  draw?(ctx: CanvasRenderingContext2D, s: S, env: DrawEnv): void;
  /** Display only: readouts for the host (danger vignette, speed lines, combo callouts, side panel). Must not change `s`. */
  view?(s: S): GameView;
  /** Display only: how hard one of this game's effects shakes the screen, 0 (not at all) to 1. */
  impact?(f: Fx): number;
}

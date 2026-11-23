// Input log: a flat array of [frame, code, value] triples, ordered by frame.
// It is what the browser streams during a run and what the server replays.
import type { Input, Press } from './types';
import { W } from './types';

export const Ev = {
  L_DOWN: 0,
  L_UP: 1,
  R_DOWN: 2,
  R_UP: 3,
  PRESS_L: 4,
  PRESS_R: 5,
  PRESS_A: 6,
  PTR_ON: 7,
  PTR_MOVE: 8,
  PTR_OFF: 9,
} as const;
export type EvCode = (typeof Ev)[keyof typeof Ev];

export type InputLog = number[];

const PRESS: Record<number, Press> = { [Ev.PRESS_L]: 'l', [Ev.PRESS_R]: 'r', [Ev.PRESS_A]: 'a' };

/** Held-input state rebuilt from log events. */
export class InputTracker {
  l = false;
  r = false;
  ptr = false;
  px = W / 2;
  private presses: Press[] = [];

  apply(code: number, value: number): void {
    switch (code) {
      case Ev.L_DOWN: this.l = true; break;
      case Ev.L_UP: this.l = false; break;
      case Ev.R_DOWN: this.r = true; break;
      case Ev.R_UP: this.r = false; break;
      case Ev.PTR_ON: this.ptr = true; this.px = value; break;
      case Ev.PTR_MOVE: this.px = value; break;
      case Ev.PTR_OFF: this.ptr = false; break;
      default:
        if (PRESS[code]) this.presses.push(PRESS[code]!);
    }
  }

  /** Input for the next step; clears the pending presses. */
  take(): Input {
    const presses = this.presses;
    this.presses = [];
    return { l: this.l, r: this.r, ptr: this.ptr, px: this.px, presses };
  }
}

export const MAX_LOG_EVENTS = 400_000;

/** Structural check of a log. Returns an error string or null. */
export function validateLog(log: unknown, frames: number): string | null {
  if (!Array.isArray(log)) return 'log is not an array';
  if (log.length % 3 !== 0) return 'log length is not a multiple of 3';
  if (log.length / 3 > MAX_LOG_EVENTS) return 'log is too long';
  let last = 0;
  for (let i = 0; i < log.length; i += 3) {
    const f = log[i], c = log[i + 1], v = log[i + 2];
    if (!Number.isInteger(f) || !Number.isInteger(c) || !Number.isInteger(v)) return 'log holds a non-integer';
    if (f < last) return 'log frames go backwards';
    if (f >= frames) return 'log event after the last frame';
    if (c < 0 || c > 9) return 'unknown event code';
    if (v < 0 || v > W) return 'pointer value out of range';
    last = f;
  }
  return null;
}

export interface PressStats {
  presses: number;
  /** Most presses in any one-second window (60 frames). */
  peakPerSecond: number;
  /** Coefficient of variation of the gaps between presses; 0 means perfectly regular. */
  intervalCv: number;
}

/** Counts discrete inputs (presses, key-downs, pointer-downs) for rate limits and bot detection. */
export function pressStats(log: InputLog): PressStats {
  const frames: number[] = [];
  for (let i = 0; i < log.length; i += 3) {
    const c = log[i + 1]!;
    if (c === Ev.PRESS_L || c === Ev.PRESS_R || c === Ev.PRESS_A) frames.push(log[i]!);
  }
  let peak = 0;
  for (let a = 0, b = 0; b < frames.length; b++) {
    while (frames[b]! - frames[a]! >= 60) a++;
    peak = Math.max(peak, b - a + 1);
  }
  let cv = 1;
  if (frames.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < frames.length; i++) gaps.push(frames[i]! - frames[i - 1]!);
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((x, y) => x + (y - mean) ** 2, 0) / gaps.length);
    cv = mean > 0 ? sd / mean : 0;
  }
  return { presses: frames.length, peakPerSecond: peak, intervalCv: cv };
}

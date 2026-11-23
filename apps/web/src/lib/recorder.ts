// Pure pieces of the play loop: the fixed-step accumulator, the mapping from browser input to
// input-log events, and the bookkeeping of what has been streamed to the server.
import { Ev, STEP, W } from '@podium/games';
import type { StreamChunk } from '@podium/shared';

/** Turns variable frame times into whole 1/60 s steps, with a cap on catch-up. */
export class Accumulator {
  private acc = 0;
  constructor(
    readonly step: number = STEP,
    readonly maxSteps: number = 5,
  ) {}

  /** Adds elapsed seconds and returns how many fixed steps to run now. */
  add(dt: number): number {
    if (!(dt > 0)) return 0;
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    // Still behind after the cap: drop the backlog instead of spiralling.
    if (this.acc >= this.step) this.acc = 0;
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}

/** What the browser currently holds down. */
export interface Held {
  l: boolean;
  r: boolean;
  ptr: boolean;
  px: number;
}
export const newHeld = (): Held => ({ l: false, r: false, ptr: false, px: -1 });

export type EvPair = [code: number, value: number];

const clampX = (x: number): number => Math.max(0, Math.min(W, Math.round(x)));

/** Events for a key going down. `code` is KeyboardEvent.code; key repeat must be filtered by the caller. */
export function keyDownEvents(code: string, held: Held): EvPair[] {
  if (code === 'ArrowLeft') {
    const out: EvPair[] = held.l ? [] : [[Ev.L_DOWN, 0]];
    held.l = true;
    out.push([Ev.PRESS_L, 0]);
    return out;
  }
  if (code === 'ArrowRight') {
    const out: EvPair[] = held.r ? [] : [[Ev.R_DOWN, 0]];
    held.r = true;
    out.push([Ev.PRESS_R, 0]);
    return out;
  }
  if (code === 'Space' || code === 'ArrowUp') return [[Ev.PRESS_A, 0]];
  return [];
}

export function keyUpEvents(code: string, held: Held): EvPair[] {
  if (code === 'ArrowLeft' && held.l) {
    held.l = false;
    return [[Ev.L_UP, 0]];
  }
  if (code === 'ArrowRight' && held.r) {
    held.r = false;
    return [[Ev.R_UP, 0]];
  }
  return [];
}

/** A press from where the stage was touched: thirds (left, action, right) for `mid` games, halves otherwise. */
export const pressAt = (x: number, mid: boolean): number =>
  mid ? (x < W * 0.3 ? Ev.PRESS_L : x > W * 0.7 ? Ev.PRESS_R : Ev.PRESS_A) : x < W / 2 ? Ev.PRESS_L : Ev.PRESS_R;

export function pointerDownEvents(x: number, mid: boolean, held: Held): EvPair[] {
  const px = clampX(x);
  held.ptr = true;
  held.px = px;
  return [
    [Ev.PTR_ON, px],
    [pressAt(px, mid), 0],
  ];
}

/** Only reports a move when the rounded x changed. */
export function pointerMoveEvents(x: number, held: Held): EvPair[] {
  if (!held.ptr) return [];
  const px = clampX(x);
  if (px === held.px) return [];
  held.px = px;
  return [[Ev.PTR_MOVE, px]];
}

export function pointerUpEvents(held: Held): EvPair[] {
  if (!held.ptr) return [];
  held.ptr = false;
  return [[Ev.PTR_OFF, 0]];
}

/** Touch pad buttons act like the keys. */
export const padDownEvents = (k: 'l' | 'r' | 'a', held: Held): EvPair[] =>
  keyDownEvents(k === 'l' ? 'ArrowLeft' : k === 'r' ? 'ArrowRight' : 'Space', held);
export const padUpEvents = (k: 'l' | 'r' | 'a', held: Held): EvPair[] =>
  k === 'a' ? [] : keyUpEvents(k === 'l' ? 'ArrowLeft' : 'ArrowRight', held);

/** Pushed on resume so nothing stays stuck. */
export function releaseAllEvents(held: Held): EvPair[] {
  held.l = held.r = held.ptr = false;
  return [
    [Ev.L_UP, 0],
    [Ev.R_UP, 0],
    [Ev.PTR_OFF, 0],
  ];
}

/**
 * Cuts the growing input log into stream chunks. A chunk {from, to} carries the events of
 * frames from..to-1; events recorded for frame `to` itself (not simulated yet) go in the next one.
 */
export class StreamCursor {
  /** Frame the last chunk reached. */
  sentTo = 0;
  /** Highest frame the server has acknowledged. */
  acked = 0;
  private idx = 0;

  constructor(private readonly log: number[]) {}

  next(to: number): StreamChunk {
    const start = this.idx;
    while (this.idx < this.log.length && this.log[this.idx]! < to) this.idx += 3;
    const chunk: StreamChunk = { from: this.sentTo, to, ev: this.log.slice(start, this.idx) };
    this.sentTo = to;
    return chunk;
  }

  ack(to: number): void {
    if (to > this.acked) this.acked = Math.min(to, this.sentTo);
  }

  /** After a reconnect: go back to the last acknowledged frame so the next chunk resends from there. */
  rewind(): void {
    this.sentTo = this.acked;
    let i = 0;
    while (i < this.log.length && this.log[i]! < this.acked) i += 3;
    this.idx = i;
  }
}

/** The log as sent with finish: nothing recorded for a frame that was never simulated. */
export function logUpTo(log: number[], frames: number): number[] {
  let end = log.length;
  while (end >= 3 && log[end - 3]! >= frames) end -= 3;
  return end === log.length ? log : log.slice(0, end);
}

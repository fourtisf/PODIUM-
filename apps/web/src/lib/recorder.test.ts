import { describe, expect, it } from 'vitest';
import { Ev, LiveRun, STEP, gameDef, replay } from '@podium/games';
import {
  Accumulator, StreamCursor, keyDownEvents, keyUpEvents, logUpTo, newHeld, padDownEvents, padUpEvents, pointerDownEvents, pointerMoveEvents,
  pointerUpEvents, pressAt, releaseAllEvents,
} from './recorder';

describe('Accumulator', () => {
  it('turns frame times into whole 60 Hz steps and keeps the remainder', () => {
    const a = new Accumulator();
    expect(a.add(STEP * 0.5)).toBe(0);
    expect(a.add(STEP * 0.5 + 1e-9)).toBe(1);
    expect(a.add(STEP * 2.5)).toBe(2);
    expect(a.add(STEP * 0.6)).toBe(1);
  });
  it('gives 60 steps for one second of 144 Hz frames', () => {
    const a = new Accumulator();
    let n = 0;
    for (let i = 0; i < 144; i++) n += a.add(1 / 144);
    expect(Math.abs(n - 60)).toBeLessThanOrEqual(1);
  });
  it('caps catch-up at five steps and drops the backlog', () => {
    const a = new Accumulator();
    expect(a.add(1)).toBe(5);
    expect(a.add(STEP * 0.5)).toBe(0);
    expect(a.add(0)).toBe(0);
    expect(a.add(-1)).toBe(0);
  });
});

describe('input mapping', () => {
  it('maps arrow keys to hold and press events and ignores a second down', () => {
    const h = newHeld();
    expect(keyDownEvents('ArrowLeft', h)).toEqual([[Ev.L_DOWN, 0], [Ev.PRESS_L, 0]]);
    expect(keyDownEvents('ArrowLeft', h)).toEqual([[Ev.PRESS_L, 0]]);
    expect(keyUpEvents('ArrowLeft', h)).toEqual([[Ev.L_UP, 0]]);
    expect(keyUpEvents('ArrowLeft', h)).toEqual([]);
    expect(keyDownEvents('ArrowRight', h)).toEqual([[Ev.R_DOWN, 0], [Ev.PRESS_R, 0]]);
    expect(keyDownEvents('Space', h)).toEqual([[Ev.PRESS_A, 0]]);
    expect(keyDownEvents('ArrowUp', h)).toEqual([[Ev.PRESS_A, 0]]);
    expect(keyDownEvents('KeyQ', h)).toEqual([]);
  });
  it('splits taps into halves, or thirds for mid games', () => {
    expect(pressAt(100, false)).toBe(Ev.PRESS_L);
    expect(pressAt(300, false)).toBe(Ev.PRESS_R);
    expect(pressAt(100, true)).toBe(Ev.PRESS_L);
    expect(pressAt(240, true)).toBe(Ev.PRESS_A);
    expect(pressAt(400, true)).toBe(Ev.PRESS_R);
  });
  it('reports pointer moves only when the rounded x changes', () => {
    const h = newHeld();
    expect(pointerMoveEvents(10, h)).toEqual([]);
    expect(pointerDownEvents(120.4, false, h)).toEqual([[Ev.PTR_ON, 120], [Ev.PRESS_L, 0]]);
    expect(pointerMoveEvents(120.2, h)).toEqual([]);
    expect(pointerMoveEvents(121.6, h)).toEqual([[Ev.PTR_MOVE, 122]]);
    expect(pointerMoveEvents(9999, h)).toEqual([[Ev.PTR_MOVE, 480]]);
    expect(pointerUpEvents(h)).toEqual([[Ev.PTR_OFF, 0]]);
    expect(pointerUpEvents(h)).toEqual([]);
  });
  it('makes pad buttons act like keys and releases everything on resume', () => {
    const h = newHeld();
    expect(padDownEvents('l', h)).toEqual([[Ev.L_DOWN, 0], [Ev.PRESS_L, 0]]);
    expect(padDownEvents('a', h)).toEqual([[Ev.PRESS_A, 0]]);
    expect(padUpEvents('a', h)).toEqual([]);
    expect(releaseAllEvents(h)).toEqual([[Ev.L_UP, 0], [Ev.R_UP, 0], [Ev.PTR_OFF, 0]]);
    expect(h).toMatchObject({ l: false, r: false, ptr: false });
    expect(padUpEvents('l', h)).toEqual([]);
  });
});

describe('StreamCursor', () => {
  it('cuts contiguous chunks holding the events of frames from..to-1', () => {
    const log = [0, 4, 0, 5, 0, 0, 5, 1, 0, 9, 6, 0];
    const c = new StreamCursor(log);
    expect(c.next(5)).toEqual({ from: 0, to: 5, ev: [0, 4, 0] });
    log.push(12, 6, 0);
    expect(c.next(10)).toEqual({ from: 5, to: 10, ev: [5, 0, 0, 5, 1, 0, 9, 6, 0] });
    expect(c.next(10)).toEqual({ from: 10, to: 10, ev: [] });
    expect(c.next(13)).toEqual({ from: 10, to: 13, ev: [12, 6, 0] });
  });
  it('rewinds to the last acknowledged frame after a reconnect', () => {
    const log = [1, 6, 0, 7, 6, 0, 12, 6, 0];
    const c = new StreamCursor(log);
    c.next(5);
    c.ack(5);
    c.next(10);
    c.rewind();
    expect(c.next(15)).toEqual({ from: 5, to: 15, ev: [7, 6, 0, 12, 6, 0] });
    c.ack(99);
    expect(c.acked).toBe(15);
  });
  it('streams a real run so the chunks add up to the finish log', () => {
    const live = new LiveRun(gameDef('duck'), 12345);
    const c = new StreamCursor(live.log);
    const streamed: number[] = [];
    let lastTo = 0;
    for (let f = 0; f < 3000 && !live.dead; f++) {
      if (f % 37 === 0) live.push(f % 2 ? Ev.L_DOWN : Ev.R_DOWN);
      if (f % 53 === 0) live.push(Ev.L_UP), live.push(Ev.R_UP);
      live.step();
      if (f % 60 === 59) {
        const ch = c.next(live.frame);
        expect(ch.from).toBe(lastTo);
        for (let i = 0; i < ch.ev.length; i += 3) expect(ch.ev[i]).toBeLessThan(ch.to);
        lastTo = ch.to;
        streamed.push(...ch.ev);
      }
    }
    streamed.push(...c.next(live.frame).ev);
    const log = logUpTo(live.log, live.frame);
    expect(streamed).toEqual(log);
    // The server's replay of that log gives the score the browser showed.
    expect(replay(gameDef('duck'), 12345, log, live.frame).score).toBe(live.score);
  });
});

describe('logUpTo', () => {
  it('drops events recorded for a frame that was never simulated', () => {
    expect(logUpTo([0, 6, 0, 3, 6, 0, 4, 6, 0], 4)).toEqual([0, 6, 0, 3, 6, 0]);
    const whole = [0, 6, 0];
    expect(logUpTo(whole, 1)).toBe(whole);
  });
});

import { describe, expect, it } from 'vitest';
import { blaster } from '../src/blaster';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { STEP, type Input } from '../src/types';
import { checkDeterministic } from './helpers';

const idle = (): Input => ({ l: false, r: false, ptr: false, px: 240, presses: [] });

/** A state with the wave logic parked: one far-away enemy keeps the next wave from starting. */
function parked() {
  const s = blaster.init(7);
  s.wave = 1;
  s.en.push({ k: 's', x: 60, y: 100, hp: 99, pts: 25, c: '#ffd84a', ty: 100, cd: 1e9, dir: 0, hit: 0 });
  return s;
}

describe('blaster', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(blaster));

  it('starts with three lives, centred, on wave 0', () => {
    const s = blaster.init(1);
    expect(s).toMatchObject({ lives: 3, x: 240, wave: 0, score: 0, t: 0, seed: 1, fx: [] });
  });

  it('a run with no input eventually ends', () => {
    for (const seed of [1, 2, 3]) {
      const r = replay(blaster, seed, [], 60 * 1200);
      expect(r.dead).toBe(true);
      expect(r.seconds).toBeGreaterThan(1.8 * 2);
    }
  });

  it('auto-fire kills score points times the combo multiplier', () => {
    const s = parked();
    s.en.push({ k: 'g', x: 240, y: 300, hp: 1, pts: 10, c: '#ff4f81', ph: 0, vy: 0, hit: 0 });
    for (let i = 0; i < 60 && s.score === 0; i++) blaster.update(s, idle(), STEP);
    expect(s.score).toBe(10);
    expect(s.combo).toBe(1);
    expect(s.ct).toBeCloseTo(1.7, 1);

    // combo 4..7 doubles, and the multiplier caps at x8.
    s.combo = 4; s.ct = 1.7;
    s.en.push({ k: 'd', x: 240, y: 300, hp: 1, pts: 15, c: '#a79bff', vy: 0, hit: 0 });
    for (let i = 0; i < 60 && s.score === 10; i++) blaster.update(s, idle(), STEP);
    expect(s.score).toBe(10 + 15 * 2);
    s.combo = 400; s.ct = 1.7;
    s.en.push({ k: 'g', x: 240, y: 300, hp: 1, pts: 10, c: '#ff4f81', ph: 0, vy: 0, hit: 0 });
    for (let i = 0; i < 60 && s.score === 40; i++) blaster.update(s, idle(), STEP);
    expect(s.score).toBe(40 + 10 * 8);
  });

  it('the combo lapses after 1.7 s without a kill', () => {
    const s = parked();
    s.combo = 9; s.ct = 1.7;
    for (let i = 0; i < 90; i++) blaster.update(s, idle(), STEP);
    expect(s.combo).toBe(9);
    for (let i = 0; i < 20; i++) blaster.update(s, idle(), STEP);
    expect(s.combo).toBe(0);
  });

  it('fires every 0.19 s, or every 0.095 s with rapid fire, and three bullets with spread', () => {
    const count = (setup: (s: ReturnType<typeof parked>) => void) => {
      const s = parked();
      s.x = 400; // away from the parked enemy
      setup(s);
      let shots = 0;
      for (let i = 0; i < 60; i++) {
        const before = s.bul.length;
        blaster.update(s, idle(), STEP);
        shots += Math.max(0, s.bul.length - before);
      }
      return shots;
    };
    const normal = count(() => {});
    expect(normal).toBeGreaterThanOrEqual(5);
    expect(normal).toBeLessThanOrEqual(6);
    const rapid = count((s) => { s.rapid = 10; });
    expect(rapid).toBeGreaterThanOrEqual(10);
    expect(rapid).toBeLessThanOrEqual(11);
    expect(count((s) => { s.spread = 10; })).toBe(normal * 3);
  });

  it('a hit costs a life and grants 1.8 s of invulnerability; a shield absorbs one hit', () => {
    const s = parked();
    s.eb.push({ x: 240, y: 555, vx: 0, vy: 0 });
    expect(blaster.update(s, idle(), STEP)).toBe(false);
    expect(s.lives).toBe(2);
    expect(s.inv).toBe(1.8);
    // Invulnerable: the next bullet is swallowed.
    s.eb.push({ x: 240, y: 555, vx: 0, vy: 0 });
    blaster.update(s, idle(), STEP);
    expect(s.lives).toBe(2);

    s.inv = 0; s.sh = 1;
    s.eb.push({ x: 240, y: 555, vx: 0, vy: 0 });
    blaster.update(s, idle(), STEP);
    expect(s.lives).toBe(2);
    expect(s.sh).toBe(0);
    expect(s.inv).toBe(1);

    s.inv = 0; s.lives = 1;
    s.eb.push({ x: 240, y: 555, vx: 0, vy: 0 });
    expect(blaster.update(s, idle(), STEP)).toBe(true);
    expect(s.lives).toBe(0);
  });

  it('wave sizes follow 5 + floor(1.5 x wave) and every fifth wave is a boss', () => {
    const s = blaster.init(3);
    blaster.update(s, idle(), STEP);
    expect(s.wave).toBe(1);
    expect(s.left).toBe(6);
    expect(s.spawnT).toBeCloseTo(1.1 - STEP, 6);

    s.wave = 4; s.left = 0; s.en = [];
    blaster.update(s, idle(), STEP);
    expect(s.wave).toBe(5);
    expect(s.left).toBe(0);
    expect(s.en).toHaveLength(1);
    expect(s.en[0]).toMatchObject({ k: 'b', hp: 61, max: 61, pts: 300 });
  });

  it('killing the boss drops spread and shield capsules', () => {
    const s = blaster.init(3);
    s.wave = 5;
    s.en.push({ k: 'b', x: 240, y: 300, hp: 1, max: 61, pts: 300, c: '#ff8a3c', cd: 9, ph: 0, hit: 0 });
    for (let i = 0; i < 60 && s.score === 0; i++) blaster.update(s, idle(), STEP);
    expect(s.score).toBe(300);
    expect(s.pu.map((p) => p.k)).toEqual(['S', 'H']);
  });

  it('collecting capsules arms spread, rapid fire and the shield', () => {
    const s = parked();
    s.pu.push({ x: 240, y: 550, k: 'S' }, { x: 240, y: 550, k: 'R' }, { x: 240, y: 550, k: 'H' });
    blaster.update(s, idle(), STEP);
    expect(s.pu).toHaveLength(0);
    expect(s.spread).toBe(10);
    expect(s.rapid).toBe(10);
    expect(s.sh).toBe(1);
    expect(s.fx.filter((f) => f.k === 'text').map((f) => (f.k === 'text' ? f.t : ''))).toEqual(['Shield up', 'Rapid fire', 'Spread shot']);
  });

  it('moves at 390 px/s with the keys and stays inside the field', () => {
    const run = new LiveRun(blaster, 5);
    run.push(Ev.L_DOWN);
    for (let i = 0; i < 6; i++) run.step();
    expect(run.state.x).toBeCloseTo(240 - 390 * 6 * STEP, 6);
    for (let i = 0; i < 60; i++) run.step();
    expect(run.state.x).toBe(24);
  });

  it('different seeds diverge', () => {
    const at = (seed: number) => {
      const s = blaster.init(seed);
      for (let i = 0; i < 60 * 6; i++) blaster.update(s, idle(), STEP);
      return JSON.stringify(s.en);
    };
    expect(at(1)).toBe(at(1));
    expect(at(1)).not.toBe(at(2));
  });
});

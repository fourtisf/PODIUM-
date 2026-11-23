import { describe, expect, it } from 'vitest';
import { hop } from '../src/hop';
import { Ev } from '../src/log';
import { LiveRun, replay } from '../src/runner';
import { checkDeterministic } from './helpers';

const idle = { l: false, r: false, ptr: false, px: 240, presses: [] };

describe('hop', () => {
  it('same seed and inputs give the same score', () => checkDeterministic(hop));

  it('bounces off a platform at -580 px/s and dies after falling 690 px below the camera', () => {
    const s = hop.init(1);
    s.plats = [{ x: 240, y: 560, w: 90 }];
    s.top = -1e9; // no new platforms
    let bounced = false;
    for (let f = 0; f < 120 && !bounced; f++) {
      expect(hop.update(s, idle, 1 / 60)).toBe(false);
      bounced = s.vy === -580;
    }
    expect(bounced).toBe(true);
    expect(s.y).toBe(560 - 16);
    // Remove the platform: the next fall is fatal once y passes cam + 690.
    s.plats = [];
    let dead = false;
    for (let f = 0; f < 600 && !dead; f++) dead = hop.update(s, idle, 1 / 60);
    expect(dead).toBe(true);
    expect(s.y).toBeGreaterThan(s.cam + 690);
  });

  it('score is the best height reached, 1 point per 10 px above the start line', () => {
    for (const seed of [1, 2, 3]) {
      const run = new LiveRun(hop, seed);
      let best = 0;
      for (let f = 0; f < 60 * 30 && !run.dead; f++) {
        // Steer with the pointer towards the highest platform below the player's feet.
        const s = run.state;
        const next = s.plats.filter((p) => p.y >= s.y + 16).sort((a, b) => a.y - b.y)[0];
        if (next) run.push(f === 0 ? Ev.PTR_ON : Ev.PTR_MOVE, next.x);
        run.step();
        best = Math.max(best, 300 - s.y);
        expect(s.cam).toBeCloseTo(-best, 9);
        expect(s.score).toBe(Math.max(0, Math.floor(-s.cam / 10)));
      }
      expect(run.score).toBeGreaterThan(0);
    }
  });

  it('wraps around the sides', () => {
    const run = new LiveRun(hop, 1);
    run.push(Ev.L_DOWN);
    let wrapped = false;
    let prev = run.state.x;
    for (let f = 0; f < 60 && !run.dead; f++) {
      run.step();
      if (run.state.x > prev) wrapped = true;
      prev = run.state.x;
    }
    expect(wrapped).toBe(true);
  });

  it('platforms come from the seed', () => {
    const xs = [1, 2, 3].map((seed) => hop.init(seed).plats[1]!.x);
    expect(new Set(xs).size).toBe(3);
    expect(replay(hop, 1, [], 600).dead).toBe(false);
  });
});

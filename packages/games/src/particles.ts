// Particle layer (the prototype's FXP, burst, fxStep, fxDraw). Visual only, so it may use Math.random().
import type { Ctx } from './draw-util';

interface P { x: number; y: number; vx: number; vy: number; l: number; t: number; c: string; r: number }

export class Particles {
  private list: P[] = [];

  clear(): void {
    this.list.length = 0;
  }

  burst(x: number, y: number, c: string, n: number, sp?: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = (sp || 170) * (0.25 + Math.random());
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 0.35 + Math.random() * 0.45, t: 0, c, r: 1.5 + Math.random() * 3 });
    }
    if (this.list.length > 400) this.list.splice(0, this.list.length - 400);
  }

  step(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.t += dt;
      if (p.t > p.l) { this.list.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy += 220 * dt;
    }
  }

  draw(cx: Ctx): void {
    for (const p of this.list) {
      cx.globalAlpha = Math.max(0, 1 - p.t / p.l);
      cx.fillStyle = p.c;
      cx.beginPath();
      cx.arc(p.x, p.y, p.r, 0, 7);
      cx.fill();
    }
    cx.globalAlpha = 1;
  }
}

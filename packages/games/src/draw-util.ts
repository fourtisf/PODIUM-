// Canvas helpers shared by the 2D games' draw functions (from the prototype's rr, sky, capsule, PUC).
import { H, W } from './types';

export type Ctx = CanvasRenderingContext2D;

export function rr(cx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  cx.beginPath();
  cx.roundRect(x, y, w, h, r);
  cx.fill();
}

export function sky(cx: Ctx, a: string, b: string): void {
  const g = cx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, H);
}

/** Power-up capsule colours, keyed by letter. */
export const PUC: Record<string, string> = { S: '#7af0c5', R: '#ffd84a', H: '#7dd3fc', W: '#7af0c5', M: '#ff4f81', L: '#ff8a8a' };

export function capsule(cx: Ctx, x: number, y: number, k: string, c: string): void {
  cx.fillStyle = c;
  rr(cx, x - 15, y - 11, 30, 22, 11);
  cx.fillStyle = '#ffffff55';
  rr(cx, x - 12, y - 9, 24, 7, 4);
  cx.fillStyle = '#0a0d24';
  cx.font = '800 13px system-ui';
  cx.textAlign = 'center';
  cx.fillText(k, x, y + 5);
}

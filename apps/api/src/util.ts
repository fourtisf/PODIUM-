import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const hmac = (secret: string, data: string): string => createHmac('sha256', secret).update(data).digest('hex');
export const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');
export const token = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Escapes text placed inside a notification body (which is rendered as HTML with <b> only). */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** No 0/O, 1/I/L: codes are read aloud and typed. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const shortCode = (n: number): string => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
export const digits = (n: number): string => Array.from({ length: n }, () => randomInt(10)).join('');

/** Deterministic float in [0, 1) from a secret and a label, for outcomes that must replay identically. */
export function seededUnit(secret: string, label: string): number {
  return parseInt(hmac(secret, label).slice(0, 12), 16) / 2 ** 48;
}

export const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

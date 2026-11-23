// Display names: 3 to 16 characters from letters, digits, space, underscore, dot, hyphen.
// Chosen names cannot start with "Guest" or "Player"; those prefixes are for generated names.
export const NAME_MIN = 3;
export const NAME_MAX = 16;

export const cleanName = (v: unknown): string =>
  String(v ?? '')
    .replace(/[^\w .-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);

export type NameError = 'length' | 'chars' | 'reserved';

export function validateName(v: string): NameError | null {
  if (v !== cleanName(v)) return 'chars';
  if (v.length < NAME_MIN || v.length > NAME_MAX) return 'length';
  if (/^(guest|player)/i.test(v)) return 'reserved';
  return null;
}

export const nameErrorText: Record<NameError, string> = {
  length: 'Names are 3 to 16 characters.',
  chars: 'Use letters, digits, spaces, underscores, dots and hyphens only.',
  reserved: 'Names cannot start with "Guest" or "Player".',
};

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Stable 32-bit hash used for avatar fallbacks, as in the prototype. */
export const hashName = (s: string): number => {
  let h = 7;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

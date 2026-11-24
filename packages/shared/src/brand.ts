// The product name lives here and nowhere else. Override with BRAND_NAME / NEXT_PUBLIC_BRAND_NAME.
// (Written as literal process.env reads so Next.js can inline the public one in the browser.)
declare const process: { env: Record<string, string | undefined> };

function envName(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_BRAND_NAME || process.env.BRAND_NAME;
  } catch {
    return undefined;
  }
}

function envX(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_X_URL;
  } catch {
    return undefined;
  }
}

function envCa(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_TOKEN_CA;
  } catch {
    return undefined;
  }
}

/** The official X profile. NEXT_PUBLIC_X_URL overrides it; set it to "none" to hide the X links. */
export const X_PROFILE = 'https://x.com/PlayClimbGames';

/** The project's X (Twitter) profile link, or null when it is turned off or not a valid x.com / twitter.com profile. */
export function xUrl(v: string | undefined = envX()): string | null {
  if ((v ?? '').trim().toLowerCase() === 'none') return null;
  const u = (v ?? '').trim() || X_PROFILE;
  return /^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/.test(u) ? u : null;
}

/** The token contract address shown on the site, or null ("Coming soon") until NEXT_PUBLIC_TOKEN_CA holds a Solana address. */
export function tokenCa(v: string | undefined = envCa()): string | null {
  const a = (v ?? '').trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
}

function envContact(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_CONTACT_EMAIL || process.env.CONTACT_EMAIL;
  } catch {
    return undefined;
  }
}

/** The contact address shown on /terms and /privacy, or null until CONTACT_EMAIL / NEXT_PUBLIC_CONTACT_EMAIL is set. */
export function contactEmail(v: string | undefined = envContact()): string | null {
  const e = (v ?? '').trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? e : null;
}

export const BRAND = {
  name: envName() || 'Climb Games',
  line: 'Skill games with weekly prize pools',
  currency: 'tChips',
} as const;

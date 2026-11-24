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

/** The project's X (Twitter) profile, or null until NEXT_PUBLIC_X_URL is set to an x.com / twitter.com link. */
export function xUrl(v: string | undefined = envX()): string | null {
  const u = (v ?? '').trim();
  return /^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/.test(u) ? u : null;
}

/** The token contract address shown on the site, or null ("Coming soon") until NEXT_PUBLIC_TOKEN_CA holds a Solana address. */
export function tokenCa(v: string | undefined = envCa()): string | null {
  const a = (v ?? '').trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
}

export const BRAND = {
  name: envName() || 'Climb Games',
  line: 'Skill games with weekly prize pools',
  currency: 'tChips',
} as const;

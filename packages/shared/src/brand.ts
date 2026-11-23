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

export const BRAND = {
  name: envName() || 'Podium',
  line: 'Skill games with weekly prize pools',
  currency: 'tChips',
} as const;

// The product name lives here and nowhere else. Override with BRAND_NAME / NEXT_PUBLIC_BRAND_NAME.
const env = (typeof process !== 'undefined' && process.env) || ({} as Record<string, string | undefined>);

export const BRAND = {
  name: env.NEXT_PUBLIC_BRAND_NAME || env.BRAND_NAME || 'Podium',
  line: 'Skill games with weekly prize pools',
  currency: 'tChips',
} as const;

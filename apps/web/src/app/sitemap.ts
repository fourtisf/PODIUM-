// /sitemap.xml: the public pages. Player pages (/profile, /play, /c/<code>) are left out.
import type { MetadataRoute } from 'next';
import { publicUrl } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const PAGES: [path: string, freq: 'daily' | 'weekly' | 'monthly', priority: number][] = [
  ['/', 'daily', 1],
  ['/leaderboard', 'daily', 0.8],
  ['/duels', 'weekly', 0.7],
  ['/shop', 'weekly', 0.5],
  ['/rules', 'monthly', 0.5],
  ['/terms', 'monthly', 0.3],
  ['/privacy', 'monthly', 0.3],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicUrl();
  return PAGES.map(([path, changeFrequency, priority]) => ({ url: base + path, changeFrequency, priority }));
}

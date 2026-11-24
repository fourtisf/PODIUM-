// Challenge landing: link previews get Open Graph and Twitter tags pointing at the generated
// card, and the page itself is the home page with the challenge sheet open.
import type { Metadata } from 'next';
import { BRAND, GAMES, fmt } from '@podium/shared';
import { HomeScreen, loadChallenge } from '@/components/HomeScreen';
import { serverT } from '@/i18n/server';

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const c = await loadChallenge(params.code);
  const t = serverT('pages');
  if (!c) return { title: t('meta.challenge') };
  const title = t('meta.challengeTitle', { name: c.name, score: fmt(c.score), game: GAMES[c.game].name });
  const description = t('meta.challengeDesc', { brand: BRAND.name });
  const image = `/og/${encodeURIComponent(c.code)}`;
  return {
    title,
    description,
    openGraph: { type: 'website', siteName: BRAND.name, title, description, url: `/c/${encodeURIComponent(c.code)}`, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function ChallengePage({ params }: { params: { code: string } }) {
  return <HomeScreen challengeCode={params.code} />;
}

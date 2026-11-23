// Challenge landing: link previews get Open Graph and Twitter tags pointing at the generated
// card, and the page itself is the home page with the challenge sheet open.
import type { Metadata } from 'next';
import { BRAND, GAMES, fmt } from '@podium/shared';
import { HomeScreen, loadChallenge } from '@/components/HomeScreen';

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const c = await loadChallenge(params.code);
  if (!c) return { title: 'Challenge' };
  const title = `${c.name} scored ${fmt(c.score)} in ${GAMES[c.game].name}`;
  const description = `Can you beat this score? One run on ${BRAND.name}, free.`;
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

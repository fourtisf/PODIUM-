// The in-game stage. Client-rendered: the run itself lives in the browser and on the API.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GAMES, isGameKey } from '@podium/shared';
import type { RunMode } from '@podium/shared';
import { PlayClient } from '@/components/PlayClient';

const MODES: RunMode[] = ['ranked', 'practice', 'cup', 'duel', 'challenge'];
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function generateMetadata({ params }: { params: { game: string } }): Metadata {
  return { title: isGameKey(params.game) ? GAMES[params.game].name : 'Play', robots: { index: false } };
}

export default function PlayPage({ params, searchParams }: { params: { game: string }; searchParams: Search }) {
  if (!isGameKey(params.game)) notFound();
  const m = one(searchParams.mode) as RunMode | undefined;
  const mode: RunMode = m && MODES.includes(m) ? m : 'practice';
  const duel = one(searchParams.duel);
  const code = one(searchParams.c);
  return <PlayClient game={params.game} mode={mode} duelId={mode === 'duel' ? duel : undefined} code={mode === 'challenge' ? code : undefined} forcePad={one(searchParams.pad) === '1'} />;
}

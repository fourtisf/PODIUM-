import type { Metadata } from 'next';
import type { DuelsResponse } from '@podium/shared';
import { DuelsView } from '@/components/DuelsView';
import { serverGet } from '@/lib/server-api';
import { IdArea } from '@/i18n/IdArea';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.duels') };
}

export default async function DuelsPage() {
  return (
    <IdArea areas={['duels']}>
      <DuelsView initial={await serverGet<DuelsResponse>('/duels')} />
    </IdArea>
  );
}

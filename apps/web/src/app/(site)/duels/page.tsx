import type { Metadata } from 'next';
import type { DuelsResponse } from '@podium/shared';
import { DuelsView } from '@/components/DuelsView';
import { serverGet } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Duels' };

export default async function DuelsPage() {
  return <DuelsView initial={await serverGet<DuelsResponse>('/duels')} />;
}

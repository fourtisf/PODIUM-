import type { Metadata } from 'next';
import type { GamesResponse } from '@podium/shared';
import { ProfileView } from '@/components/ProfileView';
import { serverGet } from '@/lib/server-api';
import { IdArea } from '@/i18n/IdArea';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.profile') };
}

export default async function ProfilePage() {
  return (
    <IdArea areas={['profile']}>
      <ProfileView games={await serverGet<GamesResponse>('/games')} />
    </IdArea>
  );
}

import type { Metadata } from 'next';
import type { GamesResponse } from '@podium/shared';
import { ProfileView } from '@/components/ProfileView';
import { serverGet } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Your profile' };

export default async function ProfilePage() {
  return <ProfileView games={await serverGet<GamesResponse>('/games')} />;
}

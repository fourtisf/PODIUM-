'use client';
import { endsShort } from '@/lib/format';
import { useNow } from '@/lib/hooks';

/** Live "3d 10h 5m" countdown to a server-given end time. */
export function EndsIn({ to, serverTime }: { to: string; serverTime: string }) {
  const now = useNow(serverTime);
  return <>{endsShort(to, now)}</>;
}

'use client';
import { useNow } from '@/lib/hooks';
import { useT } from '@/i18n/client';
import { endsText } from '@/i18n/content';
import { commonEn } from '@/i18n/dict/common.en';

/** Live "3d 10h 5m" countdown to a server-given end time. */
export function EndsIn({ to, serverTime }: { to: string; serverTime: string }) {
  const now = useNow(serverTime);
  const t = useT('common', commonEn);
  return <>{endsText(t, 'short', to, now)}</>;
}

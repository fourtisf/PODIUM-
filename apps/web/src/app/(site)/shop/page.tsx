import type { Metadata } from 'next';
import type { ShopResponse } from '@podium/shared';
import { ShopView } from '@/components/ShopView';
import { serverGet } from '@/lib/server-api';
import { IdArea } from '@/i18n/IdArea';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.shop') };
}

export default async function ShopPage() {
  return (
    <IdArea areas={['shop']}>
      <ShopView initial={await serverGet<ShopResponse>('/shop')} />
    </IdArea>
  );
}

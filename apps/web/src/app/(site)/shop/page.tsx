import type { Metadata } from 'next';
import type { ShopResponse } from '@podium/shared';
import { ShopView } from '@/components/ShopView';
import { serverGet } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Shop' };

export default async function ShopPage() {
  return <ShopView initial={await serverGet<ShopResponse>('/shop')} />;
}

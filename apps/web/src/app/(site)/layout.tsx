import type { ActivityResponse } from '@podium/shared';
import { CaBar, Footer, Header, Ticker } from '@/components/Chrome';
import { serverGet } from '@/lib/server-api';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const activity = await serverGet<ActivityResponse>('/activity', { anonymous: true });
  return (
    <>
      <Header />
      <Ticker initial={activity?.items ?? []} />
      <CaBar />
      <main className="wrap">{children}</main>
      <Footer />
    </>
  );
}

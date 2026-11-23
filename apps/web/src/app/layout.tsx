import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/instrument-sans/wght.css';
import '@/styles/prototype.css';
import '@/styles/app.css';
import { BRAND } from '@podium/shared';
import type { ChainConfigResponse, MeResponse } from '@podium/shared';
import { SessionProvider } from '@/components/Session';
import { CHAIN_ON } from '@/lib/chain';
import { publicUrl, serverGet } from '@/lib/server-api';

const description = `${BRAND.line}. Thirteen skill games, weekly leaderboards and one-on-one duels, played with tChips: test chips with no value.`;

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl()),
  title: { default: `${BRAND.name}: ${BRAND.line}`, template: `%s | ${BRAND.name}` },
  description,
  applicationName: BRAND.name,
  openGraph: { type: 'website', siteName: BRAND.name, title: `${BRAND.name}: ${BRAND.line}`, description, url: '/', images: [{ url: '/og/home', width: 1200, height: 630, alt: BRAND.name }] },
  twitter: { card: 'summary_large_image', title: `${BRAND.name}: ${BRAND.line}`, description, images: ['/og/home'] },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#fbfbfd' };

// Every page shows the visitor's balance, so nothing is statically cached.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await serverGet<MeResponse>('/me');
  // Chain mode (devnet test token) is a build-time switch; with it off the API is not even asked.
  const chain = CHAIN_ON ? await serverGet<ChainConfigResponse>('/chain/config') : null;
  return (
    <html lang="en">
      <body>
        <SessionProvider initialMe={me} initialChain={chain}>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}

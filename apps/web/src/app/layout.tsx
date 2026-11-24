import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/instrument-sans/wght.css';
import '@/styles/prototype.css';
import '@/styles/app.css';
import { BRAND } from '@podium/shared';
import type { ChainConfigResponse, MeResponse } from '@podium/shared';
import { SessionProvider } from '@/components/Session';
import { LangProvider } from '@/i18n/client';
import { getLang, idBundle, serverContent, serverT } from '@/i18n/server';
import { CHAIN_ON } from '@/lib/chain';
import { publicUrl, serverGet } from '@/lib/server-api';

export function generateMetadata(): Metadata {
  const line = serverContent().brandLine(BRAND.line);
  const description = serverT('pages')('meta.description', { line });
  const title = `${BRAND.name}: ${line}`;
  return {
    metadataBase: new URL(publicUrl()),
    title: { default: title, template: `%s | ${BRAND.name}` },
    description,
    applicationName: BRAND.name,
    openGraph: { type: 'website', siteName: BRAND.name, title, description, url: '/', images: [{ url: '/og/home', width: 1200, height: 630, alt: BRAND.name }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og/home'] },
    icons: { icon: '/icon.svg' },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#fbfbfd' };

// Every page shows the visitor's balance, so nothing is statically cached.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await serverGet<MeResponse>('/me');
  // Chain mode (devnet test token) is a build-time switch; with it off the API is not even asked.
  const chain = CHAIN_ON ? await serverGet<ChainConfigResponse>('/chain/config') : null;
  const lang = getLang();
  return (
    <html lang={lang}>
      <body>
        <LangProvider lang={lang} id={lang === 'id' ? idBundle() : null}>
          <SessionProvider initialMe={me} initialChain={chain}>
            {children}
          </SessionProvider>
        </LangProvider>
      </body>
    </html>
  );
}

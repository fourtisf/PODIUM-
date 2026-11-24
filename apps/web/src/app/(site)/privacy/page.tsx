// Privacy policy. Plain language, and only what the code actually stores and sends (apps/api, apps/web).
import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND } from '@podium/shared';
import { Contact, Updated } from '@/components/Legal';
import { CHAIN_ON } from '@/lib/chain';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.privacy'), alternates: { canonical: '/privacy' } };
}

export default function PrivacyPage() {
  const name = BRAND.name;
  const t = serverT('legal');
  return (
    <section className="view on legal" id="v-privacy">
      <h1>{t('p.title')}</h1>
      <p className="lede">{t('p.lede', { name })}</p>
      <Updated />
      <div className="about">
        <div className="panelx">
          <h3>{t('p.h1')}</h3>
          <ul>
            <li>{t('p.1a')}</li>
            <li>{t('p.1b')}</li>
            <li>{t('p.1c')}</li>
            <li>{t('p.1d')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('p.h2')}</h3>
          <ul>
            <li>{t('p.2a')}</li>
            <li>{t('p.2b')}</li>
            <li>{t('p.2c')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('p.h3')}</h3>
          <ul>
            <li>{t('p.3a')}</li>
            <li>{t('p.3b')}</li>
            <li>{t('p.3c')}</li>
            <li>{t('p.3d')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('p.h4')}</h3>
          <ul>
            <li>{t('p.4a')}</li>
            <li>{t('p.4b')}</li>
            <li>{t('p.4c')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('p.h5')}</h3>
          <ul>
            <li>{t('p.5a')}</li>
            <li>{t('p.5b')}</li>
            {CHAIN_ON ? <li>{t('p.5chain')}</li> : <li>{t('p.5off')}</li>}
            <li>{t('p.5d')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('p.h6')}</h3>
          <ul>
            <li>{t('p.6a')}</li>
            <li>{t('p.6b')}</li>
            <li>{t.rich('p.6c', { contact: <Contact /> })}</li>
            <li>{t.rich('p.6d', { terms: <Link href="/terms">{t('p.terms')}</Link> })}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

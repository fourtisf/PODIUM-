// Terms of use. Plain language, and only what the site actually does (see apps/api for the rules it enforces).
import type { Metadata } from 'next';
import Link from 'next/link';
import { ANTI_ABUSE, BRAND, ECONOMY } from '@podium/shared';
import { Contact, Updated } from '@/components/Legal';
import { CHAIN_ON } from '@/lib/chain';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.terms'), alternates: { canonical: '/terms' } };
}

export default function TermsPage() {
  const name = BRAND.name;
  const t = serverT('legal');
  return (
    <section className="view on legal" id="v-terms">
      <h1>{t('t.title')}</h1>
      <p className="lede">{t('t.lede', { name })}</p>
      <Updated />
      <div className="about">
        <div className="panelx">
          <h3>{t('t.h1', { name })}</h3>
          <ul>
            <li>{t('t.1a', { name })}</li>
            <li>{t('t.1b')}</li>
            <li>{t.rich('t.1c', { how: <Link href="/rules">{t('t.how')}</Link> })}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('t.h2')}</h3>
          <ul>
            <li>{t('t.2a', { name })}</li>
            <li>{t('t.2b')}</li>
            <li>{t('t.2c')}</li>
            {CHAIN_ON && <li>{t('t.2d')}</li>}
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('t.h3')}</h3>
          <ul>
            <li>{t('t.3a')}</li>
            <li>{t('t.3b')}</li>
            <li>{t('t.3c')}</li>
            <li>{t('t.3d')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('t.h4')}</h3>
          <ul>
            <li>{t('t.4a')}</li>
            <li>{t('t.4b')}</li>
            <li>{t('t.4c')}</li>
            <li>{t('t.4d', { n: ANTI_ABUSE.minValidatedRuns })}</li>
            <li>{t('t.4e')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('t.h5')}</h3>
          <ul>
            <li>{t('t.5a')}</li>
            <li>{t('t.5b', { h: ECONOMY.duelExpiryHours })}</li>
            <li>{t('t.5c')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('t.h6')}</h3>
          <ul>
            <li>{t('t.6a', { name })}</li>
            <li>{t('t.6b')}</li>
            <li>{t.rich('t.6c', { contact: <Contact /> })}</li>
            <li>{t.rich('t.6d', { privacy: <Link href="/privacy">{t('t.privacy')}</Link> })}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

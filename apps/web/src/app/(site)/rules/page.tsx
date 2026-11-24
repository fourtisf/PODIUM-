// Rules: the prototype's "How it works" copy, with numbers read from the shared constants.
import type { Metadata } from 'next';
import { ECONOMY, fmt } from '@podium/shared';
import type { ChainConfigResponse } from '@podium/shared';
import { CHAIN_ON, liveChain } from '@/lib/chain';
import { serverGet } from '@/lib/server-api';
import { durationIn } from '@/i18n/content';
import { serverT } from '@/i18n/server';

export function generateMetadata(): Metadata {
  return { title: serverT('pages')('meta.rules') };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function RulesPage() {
  const [a, b, c] = ECONOMY.weeklySplit;
  // Chain mode (devnet test token) only; null otherwise and the page is the prototype's.
  const chain = CHAIN_ON ? liveChain(await serverGet<ChainConfigResponse>('/chain/config', { anonymous: true })) : null;
  const t = serverT('pages');
  return (
    <section className="view on" id="v-about">
      <h1>{t('rules.title')}</h1>
      <p className="lede">{t('rules.lede')}</p>
      <div className="about">
        <div className="panelx">
          <h3>{t('rules.h1')}</h3>
          <ul>
            <li>{t('rules.ranked', { n: ECONOMY.rankedEntry })}</li>
            {chain ? <li>{t('rules.practiceFree')}</li> : <li>{t('rules.practice', { n: ECONOMY.practiceEntry })}</li>}
            <li>{t('rules.best')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('rules.h2')}</h3>
          <ul>
            <li>{t('rules.split', { pay: pct(1 - ECONOMY.fee), a: pct(a), b: pct(b), c: pct(c) })}</li>
            <li>{t('rules.fee', { fee: pct(ECONOMY.fee) })}</li>
            <li>{t('rules.weekly')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('rules.h3')}</h3>
          <ul>
            <li>{t('rules.xp')}</li>
            <li>{t('rules.box', { n: Math.round(1 / ECONOMY.boxDropChance) })}</li>
            <li>{t('rules.noCash')}</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>{t('rules.h4')}</h3>
          <ul>
            <li>{t('rules.same')}</li>
            <li>{t('rules.test')}</li>
            {chain ? (
              <li>{t('rules.chainStart')}</li>
            ) : (
              <>
                <li>{t('rules.start', { start: fmt(ECONOMY.startBalance), to: ECONOMY.refillTo, under: ECONOMY.refillUnder })}</li>
                <li>{t('rules.noToken')}</li>
              </>
            )}
          </ul>
        </div>
        {chain && (
          <div className="panelx">
            <h3>{t('rules.h5')}</h3>
            <ul>
              <li>{t('rules.c1', { cluster: chain.cluster === 'devnet' ? 'devnet' : 'localnet' })}</li>
              <li>{t('rules.c2')}</li>
              <li>{t('rules.c3', { fee: chain.feeBps / 100, burn: chain.burnBps / 100 })}</li>
              <li>{t('rules.c4', { delay: durationIn(serverT('common'), chain.vestSeconds) })}</li>
              <li>{t('rules.c5')}</li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

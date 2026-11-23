// Rules: the prototype's "How it works" copy, with numbers read from the shared constants.
import type { Metadata } from 'next';
import { ECONOMY, fmt } from '@podium/shared';
import type { ChainConfigResponse } from '@podium/shared';
import { CHAIN_ON, durationText, liveChain } from '@/lib/chain';
import { serverGet } from '@/lib/server-api';

export const metadata: Metadata = { title: 'How it works' };

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function RulesPage() {
  const [a, b, c] = ECONOMY.weeklySplit;
  // Chain mode (devnet test token) only; null otherwise and the page is the prototype's.
  const chain = CHAIN_ON ? liveChain(await serverGet<ChainConfigResponse>('/chain/config', { anonymous: true })) : null;
  return (
    <section className="view on" id="v-about">
      <h1>How it works</h1>
      <p className="lede">Scores come from how well you play. No random number decides who wins.</p>
      <div className="about">
        <div className="panelx">
          <h3>Ranked and practice</h3>
          <ul>
            <li>Ranked costs {ECONOMY.rankedEntry} tChips. Every entry goes into that game&apos;s prize pool.</li>
            {chain ? (
              <li>Practice is free. The score isn&apos;t recorded and nothing joins the pool.</li>
            ) : (
              <li>Practice costs {ECONOMY.practiceEntry} tChips. The score isn&apos;t recorded and nothing joins the pool.</li>
            )}
            <li>Your best score of the week counts. A tie goes to whoever set the score first.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Prize split</h3>
          <ul>
            <li>
              {pct(1 - ECONOMY.fee)} of the pool goes to the top three: {pct(a)}, {pct(b)} and {pct(c)}.
            </li>
            <li>{pct(ECONOMY.fee)} of the pool is the platform fee.</li>
            <li>Leaderboards run weekly and close on Friday.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>XP, levels and mystery boxes</h3>
          <ul>
            <li>Ranked plays earn XP. A new personal best earns more.</li>
            <li>A mystery box shows up in about 1 ranked play in {Math.round(1 / ECONOMY.boxDropChance)}.</li>
            <li>XP and boxes have no cash value.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>What tChips are for</h3>
          <ul>
            <li>Ranked entries, duel stakes, and shop items all use the same balance.</li>
            <li>tChips are test chips. They have no value and can&apos;t be redeemed.</li>
            {chain ? (
              <li>New accounts start at 0. Every tChip is deposited from your wallet, won in a pool or duel, or earned as a reward.</li>
            ) : (
              <>
                <li>
                  You start with {fmt(ECONOMY.startBalance)} tChips. Refill brings you back to {ECONOMY.refillTo} once you drop under {ECONOMY.refillUnder}.
                </li>
                <li>No real token is connected.</li>
              </>
            )}
          </ul>
        </div>
        {chain && (
          <div className="panelx">
            <h3>Devnet test token</h3>
            <ul>
              <li>tChips are a test token on Solana {chain.cluster === 'devnet' ? 'devnet' : 'localnet'}, a test network. The token has no value and can&apos;t be exchanged for anything.</li>
              <li>A deposit moves test tokens from your wallet into the game. A withdrawal moves them back to your wallet; you sign it and the game co-signs.</li>
              <li>
                {chain.feeBps / 100}% of every pool and duel pot is the platform fee. {chain.burnBps / 100}% of every shop purchase is burned.
              </li>
              <li>tChips from missions, streaks, boxes and invites can be played at once. They can be withdrawn after {durationText(chain.vestSeconds)}.</li>
              <li>Ranked, the Cup, duels, the shop, deposits and withdrawals need a linked Solana wallet and are closed in some countries.</li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

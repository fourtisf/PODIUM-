// Terms of use. Plain language, and only what the site actually does (see apps/api for the rules it enforces).
import type { Metadata } from 'next';
import Link from 'next/link';
import { ANTI_ABUSE, BRAND, ECONOMY } from '@podium/shared';
import { Contact, Updated } from '@/components/Legal';
import { CHAIN_ON } from '@/lib/chain';

export const metadata: Metadata = { title: 'Terms', alternates: { canonical: '/terms' } };

export default function TermsPage() {
  const name = BRAND.name;
  return (
    <section className="view on legal" id="v-terms">
      <h1>Terms</h1>
      <p className="lede">The rules for using {name}. By creating an account or playing, you agree to them.</p>
      <Updated />
      <div className="about">
        <div className="panelx">
          <h3>What {name} is</h3>
          <ul>
            <li>{name} is a site of skill games with weekly leaderboards, duels, missions and a shop. It is in beta, so games, rules and features can change.</li>
            <li>Your score comes from how you play. No random draw decides who wins a board or a duel.</li>
            <li>
              The current numbers (entries, prize split, fees, rewards) are on the <Link href="/rules">How it works</Link> page.
            </li>
          </ul>
        </div>
        <div className="panelx">
          <h3>tChips have no value</h3>
          <ul>
            <li>Everything on {name} is played with tChips. tChips are test chips. They have no value.</li>
            <li>tChips cannot be bought, sold, redeemed, cashed out or exchanged for money, goods or anything else. Nobody can pay you for them and you cannot pay for them.</li>
            <li>Prizes, mission rewards, mystery boxes, XP, levels and cosmetics are all tChips or items inside the game, with no value outside it.</li>
            {CHAIN_ON && <li>When the test token is switched on, tChips are a test token on a Solana test network. That token has no value either and cannot be exchanged for anything.</li>}
          </ul>
        </div>
        <div className="panelx">
          <h3>Who can play</h3>
          <ul>
            <li>You must be 18 or older to create an account. You confirm this when you sign up.</li>
            <li>Guests can play practice runs. Ranked runs, the Cup, duels, challenges, the shop and rewards need a signed-in account.</li>
            <li>One account per person. Do not create extra accounts to invite yourself, to duel yourself, or to collect rewards more than once.</li>
            <li>Pick a display name that does not pretend to be someone else and is not offensive.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Fair play</h3>
          <ul>
            <li>Play yourself. Bots, scripts, macros, automated input and modified game clients are not allowed.</li>
            <li>Your inputs are recorded during a run. The server replays every run from those inputs and uses its own score, not the one your browser reports.</li>
            <li>A run that does not check out is rejected and its entry is not refunded. A run with machine-like input timing is held for review: it stays off the board and pays nothing until it is approved.</li>
            <li>Rewards such as missions, streaks and invites unlock after {ANTI_ABUSE.minValidatedRuns} accepted ranked runs.</li>
            <li>An account that breaks these rules can be put under review. While it is, its rewards are held, and its runs can be rejected.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Boards, duels and challenges</h3>
          <ul>
            <li>Your best score of the week counts on each board. A tie goes to whoever set the score first. Boards close weekly and the pool is split among the top places in tChips.</li>
            <li>A duel stake is taken when you enter. The winner receives the pot minus the platform fee. If nobody joins your duel within {ECONOMY.duelExpiryHours} hours, your stake comes back.</li>
            <li>Your display name, avatar and scores are public on the boards, in duels and in the activity ticker. Your best runs of the week can be offered to other players as challenges to beat.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>The service</h3>
          <ul>
            <li>{name} is provided as it is, while it is in beta. It can be down or have bugs.</li>
            <li>We can change these terms. The date at the top shows when they last changed.</li>
            <li>
              Questions, or a request to delete your account: <Contact />.
            </li>
            <li>
              How we handle your data is in the <Link href="/privacy">Privacy policy</Link>.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

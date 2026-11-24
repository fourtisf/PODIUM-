// Privacy policy. Plain language, and only what the code actually stores and sends (apps/api, apps/web).
import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND } from '@podium/shared';
import { Contact, Updated } from '@/components/Legal';
import { CHAIN_ON } from '@/lib/chain';

export const metadata: Metadata = { title: 'Privacy', alternates: { canonical: '/privacy' } };

export default function PrivacyPage() {
  const name = BRAND.name;
  return (
    <section className="view on legal" id="v-privacy">
      <h1>Privacy</h1>
      <p className="lede">What {name} stores about you, why, and who else sees it. We do not sell your data.</p>
      <Updated />
      <div className="about">
        <div className="panelx">
          <h3>Your account</h3>
          <ul>
            <li>Your email address, if you sign in by email or with Google. It is used to sign you in.</li>
            <li>Your Google account id, if you sign in with Google. We ask Google for your id and email only.</li>
            <li>Your Solana wallet address, if you sign in with or link a wallet. Signing in only signs a text message; it never sends a transaction.</li>
            <li>Your display name, avatar and frame choices, that you confirmed you are 18 or older, and who invited you, if anyone.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Your play</h3>
          <ul>
            <li>Every run: the game, mode, seed, score, the inputs you made (which key, at which frame) and its timing. We need the inputs to replay and check each run.</li>
            <li>Your tChips balance and a ledger of every change to it, your XP, items, missions, streak, season rewards, duels, challenges and notifications.</li>
            <li>Public to everyone: your display name, avatar, frame and scores on the boards, in duels, in the activity ticker, and when your best runs are offered to others as challenges to beat.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Abuse prevention</h3>
          <ul>
            <li>Your IP address. The last one you used is kept on your account, and it is used to rate-limit requests and to spot many accounts run by one person.</li>
            <li>A random device id that your browser creates. The server keeps only a hash of it, for the same reasons.</li>
            <li>Runs that look automated are held for review, and people who run the site can look at an account&apos;s runs and ledger to decide.</li>
            <li>Like most servers, ours keeps logs of requests and errors so we can fix problems.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Cookies and browser storage</h3>
          <ul>
            <li>One cookie: the session cookie that keeps you signed in. It lasts 30 days from your last visit. There are no advertising or tracking cookies and no analytics.</li>
            <li>A security token (CSRF) tied to that session, which the page sends with every change you make. It is kept in the page, not in a cookie.</li>
            <li>In your browser&apos;s local storage: the device id above, whether sound is muted, which wallet app you chose, an invite code from a link you opened, the name you picked before signing in, and which games you have seen the how-to-play card for.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>Who else gets data</h3>
          <ul>
            <li>Our email provider, to send you a sign-in code when you sign in by email. The code expires after 10 minutes.</li>
            <li>Google, when you choose to sign in with Google.</li>
            {CHAIN_ON ? (
              <li>A Solana test network (devnet) and its RPC provider, because the test token is switched on: your wallet address and your deposits and withdrawals are recorded there, and anything on that network is public.</li>
            ) : (
              <li>A Solana network provider only if the devnet test token is switched on. It is off now.</li>
            )}
            <li>Nobody else. We do not sell or rent your data, and we do not use it for advertising.</li>
          </ul>
        </div>
        <div className="panelx">
          <h3>How long we keep it</h3>
          <ul>
            <li>Runs and the ledger are kept for as long as your account exists, so the boards and payouts stay fair and can be checked later.</li>
            <li>Sign-in codes last 10 minutes; a session ends 30 days after your last visit; rate-limit counters last minutes. Database backups are kept for 14 days.</li>
            <li>
              To get a copy of your data, correct it, or delete your account, write to <Contact />. Deleting an account removes your profile, runs and ledger with it.
            </li>
            <li>
              The rules for playing are in the <Link href="/terms">Terms</Link>.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

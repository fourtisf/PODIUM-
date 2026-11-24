'use client';
// Session state for the whole app: the /me snapshot, the toast, and the sheets that can open
// from anywhere (welcome, sign in, age gate, pre-game, box reveal, challenge).
// The server is the authority: after every mutation the caller refreshes /me from here.
import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import bs58 from 'bs58';
import { solanaProvider } from '@/lib/wallets';
import WalletPicker from './WalletPicker';
import { usePathname, useRouter } from 'next/navigation';
import { BRAND, ECONOMY, GAMES, GAME_KEYS, cleanName, fmt, hashName, nameErrorText, validateName } from '@podium/shared';
import type { ChainConfigResponse, ChallengeResponse, GameKey, MeResponse, MeUser, RunMode } from '@podium/shared';
import { api, ApiFailure, errorText } from '@/lib/api';
import { liveChain } from '@/lib/chain';
import { Avatar, Cover } from './ui';

// Chain mode only: the wallet sheet is its own chunk, fetched the first time it is opened.
const WalletSheet = __CHAIN__ ? lazy(() => import('./WalletSheet')) : null;

const REF_KEY = 'podium.ref';
/** The name picked in the welcome sheet. Guests keep a generated name; this one is sent at sign-up. */
const NAME_KEY = 'podium.name';

const stored = (k: string): string | undefined => {
  try {
    return localStorage.getItem(k) || undefined;
  } catch {
    return undefined;
  }
};

export interface RevealData {
  art: React.ReactNode;
  title: string;
  sub: string;
}

interface SessionValue {
  me: MeResponse | null;
  /** Refetches /me; returns the new snapshot (null when signed out). */
  refresh(): Promise<MeResponse | null>;
  /** Applies values a mutation returned (balance, boxes, xp) before the next /me arrives. */
  patchUser(p: Partial<MeUser>): void;
  toast(text: string): void;
  /** Toasts an API failure. */
  fail(e: unknown): void;
  /** True when the visitor has a full account; otherwise opens the right sheet and returns false. */
  needAccount(): boolean;
  openSignIn(): void;
  openSheet(game: GameKey, pool: number): void;
  /** Checks what the browser can check, then goes to the play page. */
  play(game: GameKey, mode: RunMode, extra?: { duel?: string; code?: string }): void;
  reveal(d: RevealData): void;
  offerChallenge(c: ChallengeResponse | null): void;
  signOut(): Promise<void>;
  storedRef(): string | undefined;
  /** The devnet test-token settings, or null while chain mode is off (then nothing below is used). */
  chain: ChainConfigResponse | null;
  /** Opens the wallet sheet (chain mode only). */
  openWallet(): void;
  /** Toast text for "you cannot afford this". */
  lowText(): string;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** What a run costs, for display and for the "not enough" check. The server charges the real amount. */
export function runCost(mode: RunMode, me: MeResponse | null, chainOn = !!me?.chain): number {
  if (mode === 'ranked') return ECONOMY.rankedEntry;
  if (mode === 'cup') return ECONOMY.cupEntry;
  // In chain mode practice is free: the practice entry is not pooled anywhere.
  if (__CHAIN__ && mode === 'practice' && chainOn) return 0;
  if (mode === 'practice') return (me ? me.user.freePractice : ECONOMY.freePracticeRuns) > 0 ? 0 : ECONOMY.practiceEntry;
  return 0;
}

export function SessionProvider({ initialMe, initialChain = null, children }: { initialMe: MeResponse | null; initialChain?: ChainConfigResponse | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const inGame = pathname.startsWith('/play');
  const [me, setMe] = useState<MeResponse | null>(initialMe);
  const [toastText, setToastText] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const [sheet, setSheet] = useState<{ game: GameKey; pool: number } | null>(null);
  const [signIn, setSignIn] = useState(false);
  const chain = __CHAIN__ ? liveChain(initialChain) : null;
  const [walletOpen, setWalletOpen] = useState(false);
  const [revealData, setReveal] = useState<RevealData | null>(null);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const meRef = useRef(me);
  meRef.current = me;

  if (initialMe) api.setCsrf(initialMe.csrf);

  const toast = useCallback((text: string) => {
    setToastText(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 4200);
  }, []);
  const fail = useCallback(
    (e: unknown) => {
      toast(errorText(e));
      // Chain mode: the action needs a linked wallet, so offer the link flow.
      if (__CHAIN__ && chain && e instanceof ApiFailure && e.code === 'wallet_required') setWalletOpen(true);
    },
    [toast, chain],
  );
  const lowText = useCallback(
    (): string => (__CHAIN__ && chain ? 'Not enough tChips. Deposit test tokens from the Wallet.' : `Not enough tChips. Refill opens once you are under ${ECONOMY.refillUnder}.`),
    [chain],
  );

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const r = await api.me();
      setMe(r);
      return r;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) {
        setMe(null);
        return null;
      }
      return meRef.current;
    }
  }, []);

  const patchUser = useCallback((p: Partial<MeUser>) => {
    setMe((m) => (m ? { ...m, user: { ...m.user, ...p } } : m));
  }, []);

  // Keep ?ref=<code> for sign-up.
  useEffect(() => {
    try {
      const ref = new URLSearchParams(location.search).get('ref');
      if (ref && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, ref.slice(0, 32));
    } catch {
      /* private mode */
    }
  }, []);
  // A failed Google redirect comes back as /?auth_error=<why>.
  useEffect(() => {
    try {
      const q = new URLSearchParams(location.search);
      if (!q.get('auth_error')) return;
      toast('Sign-in did not work. Please try again.');
      q.delete('auth_error');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : ''));
    } catch {
      /* ignore */
    }
  }, [toast]);
  const storedRef = useCallback((): string | undefined => {
    try {
      return localStorage.getItem(REF_KEY) || undefined;
    } catch {
      return undefined;
    }
  }, []);

  // Coming back from a run (or any navigation): the balance may have changed.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    setSheet(null);
    if (!pathname.startsWith('/play')) void refresh();
  }, [pathname, refresh]);

  const needAccount = useCallback((): boolean => {
    const m = meRef.current;
    if (m && !m.user.guest && m.user.adult) {
      if (!__CHAIN__ || !chain || !m.chain?.needsWallet) return true;
      // Chain mode: ranked, duels, the shop and rewards need a linked wallet.
      toast('Link a Solana wallet to do that.');
      setWalletOpen(true);
      return false;
    }
    if (!m || m.user.guest) setSignIn(true);
    // Signed in but not confirmed adult: the age-gate sheet is already showing.
    return false;
  }, [chain, toast]);

  const play = useCallback(
    (game: GameKey, mode: RunMode, extra?: { duel?: string; code?: string }) => {
      const m = meRef.current;
      if (mode !== 'practice' && !needAccount()) return;
      if (m && m.user.balance < runCost(mode, m, !!chain)) {
        toast(lowText());
        return;
      }
      setSheet(null);
      const q = new URLSearchParams({ mode });
      if (extra?.duel) q.set('duel', extra.duel);
      if (extra?.code) q.set('c', extra.code);
      router.push(`/play/${game}?${q.toString()}`);
    },
    [needAccount, router, toast, chain, lowText],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {
      fail(e);
      return;
    }
    setMe(null);
    router.refresh();
  }, [fail, router]);

  const afterAuth = useCallback(async () => {
    await refresh();
    router.refresh();
  }, [refresh, router]);

  const value = useMemo<SessionValue>(
    () => ({
      me,
      refresh,
      patchUser,
      toast,
      fail,
      needAccount,
      openSignIn: () => setSignIn(true),
      openSheet: (game, pool) => setSheet({ game, pool }),
      play,
      reveal: setReveal,
      offerChallenge: setChallenge,
      signOut,
      storedRef,
      chain,
      openWallet: () => setWalletOpen(true),
      lowText,
    }),
    [me, refresh, patchUser, toast, fail, needAccount, play, signOut, storedRef, chain, lowText],
  );

  const needsAge = !!me && !me.user.guest && !me.user.adult;

  return (
    <Ctx.Provider value={value}>
      {children}
      {!inGame && sheet && <GameSheet game={sheet.game} pool={sheet.pool} me={me} chainOn={!!chain} onClose={() => setSheet(null)} onPlay={(mode) => play(sheet.game, mode)} />}
      {!inGame && !me && <WelcomeSheet onDone={afterAuth} toast={toast} />}
      {revealData && (
        <div className="scrim on" id="reveal" role="dialog" aria-modal="true" aria-label={revealData.title}>
          <div className="sheet">
            <div>{revealData.art}</div>
            <h3>{revealData.title}</h3>
            <p>{revealData.sub}</p>
            <button className="btn go" onClick={() => setReveal(null)}>
              Nice
            </button>
          </div>
        </div>
      )}
      {!inGame && challenge && (
        <div className="scrim on" id="chal" role="dialog" aria-modal="true" aria-label="Challenge">
          <div className="sheet">
            <div>
              <Avatar id={Number.isFinite(challenge.avatar) ? challenge.avatar : hashName(challenge.name)} size={72} />
            </div>
            <h3>{challenge.name} challenged you</h3>
            <p>
              They scored {fmt(challenge.score)} in {GAMES[challenge.game].name}. One run to beat it.
            </p>
            <button
              className="btn go"
              onClick={() => {
                const c = challenge;
                // Challenge runs need an account; the sheet stays open behind the sign-in sheet.
                if (!needAccount()) return;
                setChallenge(null);
                play(c.game, 'challenge', { code: c.code });
              }}
            >
              Take the challenge, free
            </button>
            <button className="btn alt" onClick={() => setChallenge(null)}>
              Not now
            </button>
          </div>
        </div>
      )}
      {signIn && !needsAge && (
        <SignInSheet
          onClose={() => setSignIn(false)}
          onDone={async () => {
            setSignIn(false);
            await afterAuth();
          }}
          toast={toast}
          storedRef={storedRef}
          chainOn={!!chain}
        />
      )}
      {__CHAIN__ && WalletSheet && chain && walletOpen && !inGame && !needsAge && (
        <Suspense fallback={null}>
          <WalletSheet
            chain={chain}
            me={me}
            onClose={() => setWalletOpen(false)}
            refresh={refresh}
            toast={toast}
            openSignIn={() => {
              setWalletOpen(false);
              setSignIn(true);
            }}
          />
        </Suspense>
      )}
      {needsAge && <AgeGateSheet onDone={afterAuth} onSignOut={signOut} toast={toast} />}
      <div id="toast" role="status" aria-live="polite" style={{ display: toastText ? 'block' : 'none' }}>
        {toastText}
      </div>
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- pre-game sheet
function GameSheet({ game, pool, me, chainOn, onClose, onPlay }: { game: GameKey; pool: number; me: MeResponse | null; chainOn: boolean; onClose(): void; onPlay(mode: RunMode): void }) {
  const g = GAMES[game];
  const practice = runCost('practice', me, chainOn);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.getElementById('walletpick') && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim on" id="sheetS" role="dialog" aria-modal="true" aria-label={g.name} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="cover">
          <Cover game={game} eager />
        </div>
        <div className="in">
          <h3>{g.name}</h3>
          <button className="mode go" onClick={() => onPlay('ranked')}>
            <span>
              <b>Play ranked</b>
              <small>Joins the {fmt(pool)} tChips pool</small>
            </span>
            <b className="num">{ECONOMY.rankedEntry}</b>
          </button>
          <button className="mode alt" onClick={() => onPlay('practice')}>
            <span>
              <b>Practice</b>
              <small>Score isn&apos;t recorded</small>
            </span>
            <b className="num">{practice === 0 ? 'free' : practice}</b>
          </button>
          <div className="keys">
            {g.ctl.map((c) => (
              <div key={c[0]}>
                <kbd>{c[0]}</kbd>
                <span>{c[1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- welcome
function WelcomeSheet({ onDone, toast }: { onDone(): Promise<void>; toast(t: string): void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.guest();
      const v = cleanName(name);
      if (v) {
        const bad = validateName(v);
        if (bad) toast(nameErrorText[bad] + ' You are playing as a guest for now.');
        else {
          try {
            localStorage.setItem(NAME_KEY, v);
          } catch {
            /* private mode */
          }
          // The API gives guests a generated name; the chosen one is sent when they sign in.
          toast(`You are playing as a guest for now. "${v}" becomes your name when you sign in.`);
        }
      }
      await onDone();
    } catch (e) {
      toast(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="scrim on" id="welcome" role="dialog" aria-modal="true" aria-label={`Welcome to ${BRAND.name}`}>
      <div className="sheet">
        <h3>Welcome to {BRAND.name}</h3>
        <p style={{ color: 'var(--soft)', margin: 0 }}>{numberWord(GAME_KEYS.length)} skill games with weekly prize pools and one-on-one duels.</p>
        <ol>
          <li>Ranked runs cost {ECONOMY.rankedEntry} tChips and feed that game&apos;s pool.</li>
          <li>The top three scores each week split the pool.</li>
          <li>Missions, streaks and duels earn extra along the way.</li>
        </ol>
        <div className="lbl" style={{ marginTop: 14 }}>
          Pick a name
        </div>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <input maxLength={16} placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
        </form>
        <button className="btn go" onClick={go} disabled={busy}>
          Start with {ECONOMY.freePracticeRuns} free practice runs
        </button>
      </div>
    </div>
  );
}

const numberWord = (n: number): string => (n === 13 ? 'Thirteen' : String(n));

// ---------------------------------------------------------------- sign in
export { solanaProvider, type SolanaProvider } from '@/lib/wallets';

function SignInSheet({ onClose, onDone, toast, storedRef, chainOn }: { onClose(): void; onDone(): Promise<void>; toast(t: string): void; storedRef(): string | undefined; chainOn: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [wanted, setWanted] = useState('');
  useEffect(() => {
    // The name picked in the welcome sheet, if any.
    setWanted(stored(NAME_KEY) ?? '');
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const ageOk = (): boolean => {
    if (adult) return true;
    toast('Confirm that you are 18 or older to continue.');
    return false;
  };
  const run = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await f();
    } catch (e) {
      if (e !== null) toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  /** Signs up under the chosen name; if it is taken, signs up without it (the server then generates one). */
  const withName = async (f: (name?: string) => Promise<unknown>) => {
    const v = cleanName(wanted);
    const badName = v ? validateName(v) : null;
    if (badName) {
      toast(nameErrorText[badName]);
      throw null;
    }
    const name = v || undefined;
    try {
      await f(name);
    } catch (e) {
      if (!(name && e instanceof ApiFailure && e.code === 'conflict')) throw e;
      await f(undefined);
      toast(`${e.message} You can pick another name in your profile.`);
      return;
    }
    toast('Signed in.');
  };
  const sendCode = () =>
    run(async () => {
      await api.emailRequest(email.trim());
      setSent(true);
      toast('We sent a 6-digit code to your email.');
    });
  const verify = () =>
    run(async () => {
      if (!ageOk()) return;
      await withName((name) => api.emailVerify({ email: email.trim(), code: code.trim(), adult: true, ref: storedRef(), ...(name ? { name } : {}) }));
      await onDone();
    });
  const withWallet = () =>
    run(async () => {
      if (!ageOk()) return;
      const sol = solanaProvider();
      if (!sol) return;
      let address: string, signature: string;
      try {
        address = (await sol.connect()).publicKey.toBase58();
        const { message } = await api.walletNonce(address);
        // Identity only: a signed text message, never a transaction.
        const signed = await sol.signMessage(new TextEncoder().encode(message), 'utf8');
        signature = bs58.encode(signed.signature);
      } catch (e) {
        if (e instanceof ApiFailure) throw e;
        toast('The wallet did not sign the message.');
        return;
      }
      await withName((name) => api.walletVerify({ address, signature, adult: true, ref: storedRef(), ...(name ? { name } : {}) }));
      await onDone();
    });
  const googleHref = () => {
    const ref = storedRef();
    return '/api/auth/google' + (ref ? `?ref=${encodeURIComponent(ref)}` : '');
  };

  const emailForm = (
    <>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <input type="email" required placeholder="you@example.com" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className={`sbtn ${sent ? 'lt' : ''}`} disabled={busy}>
            {sent ? 'Send again' : 'Send code'}
          </button>
        </form>
        {sent && (
          <>
            <div className="lbl">6-digit code</div>
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" aria-label="6-digit code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <button className="sbtn" disabled={busy}>
                Sign in
              </button>
            </form>
          </>
        )}
    </>
  );
  const nameAndAge = (
    <>
        <div className="lbl">Name, for a new account</div>
        <div className="field">
          <input maxLength={16} placeholder="Your name" aria-label="Name for a new account" autoComplete="nickname" value={wanted} onChange={(e) => setWanted(e.target.value)} />
        </div>
        <label className="agree">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>I am 18 or older</span>
        </label>
    </>
  );
  const googleLink = (
        <a className="btn alt" href={googleHref()}>
          Continue with Google
        </a>
  );
  // Age first, so the picker never opens only to be refused afterwards.
  const pickWallet = () => {
    if (ageOk()) setPicking(true);
  };
  const walletButton = (
          <button className="btn alt" onClick={pickWallet} disabled={busy}>
            Continue with wallet
          </button>
          );

  const agree = (
    <p className="fine">
      By signing in you agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.
    </p>
  );

  return (
    <>
    <div className="scrim on" id="signin" role="dialog" aria-modal="true" aria-label="Sign in" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h3>Sign in</h3>
        <p className="sub">{__CHAIN__ && chainOn ? 'Ranked runs, duels, the shop and rewards need an account with a Solana wallet. Your guest progress is kept.' : 'Ranked runs, duels, the shop and rewards need an account. Your guest progress is kept.'}</p>
        {__CHAIN__ && chainOn ? (
          <>
            {/* Chain mode leads with the wallet: it is the account and it holds the test token. */}
            {nameAndAge}
            <button className="btn go" onClick={pickWallet} disabled={busy}>
              Continue with wallet
            </button>
            <div className="lbl" style={{ marginTop: 18 }}>
              Or sign in by email and link a wallet afterwards
            </div>
            {emailForm}
            {googleLink}
            <p className="fine">Your wallet signs you in and holds your tChips. tChips are a devnet test token with no value.</p>
            {agree}
          </>
        ) : (
          <>
            <div className="lbl">Email</div>
            {emailForm}
            {nameAndAge}
            {googleLink}
            {walletButton}
            <p className="fine">A wallet is used to prove who you are only. tChips are test chips with no value.</p>
            {agree}
          </>
        )}
      </div>
    </div>
    {picking && (
      <WalletPicker
        onClose={() => setPicking(false)}
        onPick={() => {
          setPicking(false);
          void withWallet();
        }}
      />
    )}
    </>
  );
}

// ---------------------------------------------------------------- age gate
function AgeGateSheet({ onDone, onSignOut, toast }: { onDone(): Promise<void>; onSignOut(): Promise<void>; toast(t: string): void }) {
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!adult) {
      toast('Confirm that you are 18 or older to continue.');
      return;
    }
    setBusy(true);
    try {
      await api.adult();
      await onDone();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="scrim on" id="signin" role="dialog" aria-modal="true" aria-label="Confirm your age">
      <div className="sheet">
        <h3>Confirm your age</h3>
        <p className="sub">{BRAND.name} is for players aged 18 or older.</p>
        <label className="agree">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>I am 18 or older</span>
        </label>
        <button className="btn go" onClick={go} disabled={busy}>
          Continue
        </button>
        <button className="btn alt" onClick={() => void onSignOut()} disabled={busy}>
          Sign out
        </button>
      </div>
    </div>
  );
}

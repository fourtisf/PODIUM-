'use client';
// Session state for the whole app: the /me snapshot, the toast, and the sheets that can open
// from anywhere (welcome, sign in, age gate, pre-game, box reveal, challenge).
// The server is the authority: after every mutation the caller refreshes /me from here.
import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import bs58 from 'bs58';
import { solanaProvider } from '@/lib/wallets';
import WalletPicker from './WalletPicker';
import { usePathname, useRouter } from 'next/navigation';
import { BRAND, ECONOMY, GAMES, GAME_KEYS, cleanName, fmt, hashName, validateName } from '@podium/shared';
import type { ChainConfigResponse, ChallengeResponse, GameKey, MeResponse, MeUser, RunMode } from '@podium/shared';
import { api, ApiFailure } from '@/lib/api';
import { useContent, useErrors, useT } from '@/i18n/client';
import { commonEn } from '@/i18n/dict/common.en';
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
  const t = useT('common', commonEn);
  const errs = useErrors();

  if (initialMe) api.setCsrf(initialMe.csrf);

  const toast = useCallback((text: string) => {
    setToastText(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 4200);
  }, []);
  const fail = useCallback(
    (e: unknown) => {
      toast(errs.text(e));
      // Chain mode: the action needs a linked wallet, so offer the link flow.
      if (__CHAIN__ && chain && e instanceof ApiFailure && e.code === 'wallet_required') setWalletOpen(true);
    },
    [toast, chain, errs],
  );
  const lowText = useCallback(
    (): string => (__CHAIN__ && chain ? t('low.chain') : t('low.refill', { n: ECONOMY.refillUnder })),
    [chain, t],
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
      toast(t('auth.failed'));
      q.delete('auth_error');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : ''));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast(t('wallet.linkFirst'));
      setWalletOpen(true);
      return false;
    }
    if (!m || m.user.guest) setSignIn(true);
    // Signed in but not confirmed adult: the age-gate sheet is already showing.
    return false;
  }, [chain, toast, t]);

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
              {t('reveal.nice')}
            </button>
          </div>
        </div>
      )}
      {!inGame && challenge && (
        <div className="scrim on" id="chal" role="dialog" aria-modal="true" aria-label={t('chal.aria')}>
          <div className="sheet">
            <div>
              <Avatar id={Number.isFinite(challenge.avatar) ? challenge.avatar : hashName(challenge.name)} size={72} />
            </div>
            <h3>{t('chal.title', { name: challenge.name })}</h3>
            <p>{t('chal.body', { score: fmt(challenge.score), game: GAMES[challenge.game].name })}</p>
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
              {t('chal.take')}
            </button>
            <button className="btn alt" onClick={() => setChallenge(null)}>
              {t('chal.notNow')}
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
  const t = useT('common', commonEn);
  const gc = useContent().game(game);
  const practice = runCost('practice', me, chainOn);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.getElementById('walletpick') && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim on" id="sheetS" role="dialog" aria-modal="true" aria-label={g.name} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label={t('close')} onClick={onClose}>
          ✕
        </button>
        <div className="cover">
          <Cover game={game} eager />
        </div>
        <div className="in">
          <h3>{g.name}</h3>
          <button className="mode go" onClick={() => onPlay('ranked')}>
            <span>
              <b>{t('sheet.ranked')}</b>
              <small>{t('sheet.joins', { n: fmt(pool) })}</small>
            </span>
            <b className="num">{ECONOMY.rankedEntry}</b>
          </button>
          <button className="mode alt" onClick={() => onPlay('practice')}>
            <span>
              <b>{t('sheet.practice')}</b>
              <small>{t('sheet.notRecorded')}</small>
            </span>
            <b className="num">{practice === 0 ? t('sheet.free') : practice}</b>
          </button>
          <div className="keys">
            {gc.ctl.map((c) => (
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
  const t = useT('common', commonEn);
  const content = useContent();
  const errs = useErrors();
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.guest();
      const v = cleanName(name);
      if (v) {
        const bad = validateName(v);
        if (bad) toast(t('welcome.badName', { err: content.nameError(bad) }));
        else {
          try {
            localStorage.setItem(NAME_KEY, v);
          } catch {
            /* private mode */
          }
          // The API gives guests a generated name; the chosen one is sent when they sign in.
          toast(t('welcome.guestName', { name: v }));
        }
      }
      await onDone();
    } catch (e) {
      toast(errs.text(e));
      setBusy(false);
    }
  };
  return (
    <div className="scrim on" id="welcome" role="dialog" aria-modal="true" aria-label={t('welcome.title', { brand: BRAND.name })}>
      <div className="sheet">
        <h3>{t('welcome.title', { brand: BRAND.name })}</h3>
        <p style={{ color: 'var(--soft)', margin: 0 }}>{t('welcome.lede', { count: GAME_KEYS.length === 13 ? t('welcome.thirteen') : GAME_KEYS.length })}</p>
        <ol>
          <li>{t('welcome.r1', { n: ECONOMY.rankedEntry })}</li>
          <li>{t('welcome.r2')}</li>
          <li>{t('welcome.r3')}</li>
        </ol>
        <div className="lbl" style={{ marginTop: 14 }}>
          {t('welcome.pick')}
        </div>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <input maxLength={16} placeholder={t('welcome.ph')} aria-label={t('welcome.ph')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
        </form>
        <button className="btn go" onClick={go} disabled={busy}>
          {t('welcome.start', { n: ECONOMY.freePracticeRuns })}
        </button>
      </div>
    </div>
  );
}

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
  const t = useT('common', commonEn);
  const content = useContent();
  const errs = useErrors();
  useEffect(() => {
    // The name picked in the welcome sheet, if any.
    setWanted(stored(NAME_KEY) ?? '');
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const ageOk = (): boolean => {
    if (adult) return true;
    toast(t('signin.age'));
    return false;
  };
  const run = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await f();
    } catch (e) {
      if (e !== null) toast(errs.text(e));
    } finally {
      setBusy(false);
    }
  };
  /** Signs up under the chosen name; if it is taken, signs up without it (the server then generates one). */
  const withName = async (f: (name?: string) => Promise<unknown>) => {
    const v = cleanName(wanted);
    const badName = v ? validateName(v) : null;
    if (badName) {
      toast(content.nameError(badName));
      throw null;
    }
    const name = v || undefined;
    try {
      await f(name);
    } catch (e) {
      if (!(name && e instanceof ApiFailure && e.code === 'conflict')) throw e;
      await f(undefined);
      toast(t('signin.nameTaken', { msg: errs.text(e) }));
      return;
    }
    toast(t('signin.ok'));
  };
  const sendCode = () =>
    run(async () => {
      await api.emailRequest(email.trim());
      setSent(true);
      toast(t('signin.codeSent'));
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
        toast(t('signin.noSign'));
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
          <input type="email" required placeholder={t('signin.emailPh')} aria-label={t('signin.email')} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className={`sbtn ${sent ? 'lt' : ''}`} disabled={busy}>
            {sent ? t('signin.sendAgain') : t('signin.send')}
          </button>
        </form>
        {sent && (
          <>
            <div className="lbl">{t('signin.code')}</div>
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" aria-label={t('signin.code')} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <button className="sbtn" disabled={busy}>
                {t('signin.title')}
              </button>
            </form>
          </>
        )}
    </>
  );
  const nameAndAge = (
    <>
        <div className="lbl">{t('signin.nameLbl')}</div>
        <div className="field">
          <input maxLength={16} placeholder={t('welcome.ph')} aria-label={t('signin.nameAria')} autoComplete="nickname" value={wanted} onChange={(e) => setWanted(e.target.value)} />
        </div>
        <label className="agree">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>{t('signin.adult')}</span>
        </label>
    </>
  );
  const googleLink = (
        <a className="btn alt" href={googleHref()}>
          {t('signin.google')}
        </a>
  );
  // Age first, so the picker never opens only to be refused afterwards.
  const pickWallet = () => {
    if (ageOk()) setPicking(true);
  };
  const walletButton = (
          <button className="btn alt" onClick={pickWallet} disabled={busy}>
            {t('signin.wallet')}
          </button>
          );

  const agree = (
    <p className="fine">
      {t.rich('signin.agree', {
        terms: (
          <a href="/terms" target="_blank" rel="noopener">
            {t('signin.terms')}
          </a>
        ),
        privacy: (
          <a href="/privacy" target="_blank" rel="noopener">
            {t('signin.privacy')}
          </a>
        ),
      })}
    </p>
  );

  return (
    <>
    <div className="scrim on" id="signin" role="dialog" aria-modal="true" aria-label={t('signin.title')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label={t('close')} onClick={onClose}>
          ✕
        </button>
        <h3>{t('signin.title')}</h3>
        <p className="sub">{__CHAIN__ && chainOn ? t('signin.subChain') : t('signin.sub')}</p>
        {__CHAIN__ && chainOn ? (
          <>
            {/* Chain mode leads with the wallet: it is the account and it holds the test token. */}
            {nameAndAge}
            <button className="btn go" onClick={pickWallet} disabled={busy}>
              {t('signin.wallet')}
            </button>
            <div className="lbl" style={{ marginTop: 18 }}>
              {t('signin.orEmail')}
            </div>
            {emailForm}
            {googleLink}
            <p className="fine">{t('signin.fineChain')}</p>
            {agree}
          </>
        ) : (
          <>
            <div className="lbl">{t('signin.email')}</div>
            {emailForm}
            {nameAndAge}
            {googleLink}
            {walletButton}
            <p className="fine">{t('signin.fine')}</p>
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
  const t = useT('common', commonEn);
  const errs = useErrors();
  const go = async () => {
    if (!adult) {
      toast(t('signin.age'));
      return;
    }
    setBusy(true);
    try {
      await api.adult();
      await onDone();
    } catch (e) {
      toast(errs.text(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="scrim on" id="signin" role="dialog" aria-modal="true" aria-label={t('age.title')}>
      <div className="sheet">
        <h3>{t('age.title')}</h3>
        <p className="sub">{t('age.sub', { brand: BRAND.name })}</p>
        <label className="agree">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>{t('signin.adult')}</span>
        </label>
        <button className="btn go" onClick={go} disabled={busy}>
          {t('age.continue')}
        </button>
        <button className="btn alt" onClick={() => void onSignOut()} disabled={busy}>
          {t('age.signOut')}
        </button>
      </div>
    </div>
  );
}

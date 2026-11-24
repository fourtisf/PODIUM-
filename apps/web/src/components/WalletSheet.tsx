'use client';
// Chain mode only (devnet / local validator, TEST token with no value). The header's "Wallet"
// button opens this sheet. It is its own chunk, and the Solana libraries are another one that is
// fetched from here (lib/chain-tx), so the main bundle carries none of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import bs58 from 'bs58';
import { fmt } from '@podium/shared';
import type { ChainConfigResponse, ChainStatusResponse, MeResponse } from '@podium/shared';
import { api, ApiFailure } from '@/lib/api';
import { shortAddress } from '@/lib/chain';
import { useErrors, useLang, useT } from '@/i18n/client';
import { durationIn } from '@/i18n/content';
import { commonEn } from '@/i18n/dict/common.en';
import { walletEn } from '@/i18n/dict/wallet.en';
import type { TxProvider } from '@/lib/chain-tx';
import { solanaProvider } from '@/lib/wallets';
import WalletPicker from './WalletPicker';

const txLib = () => import('@/lib/chain-tx');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const whole = (v: string): number | null => (/^[1-9]\d{0,8}$/.test(v.trim()) ? Number(v.trim()) : null);

const when = (iso: string, lang: string): string => {
  try {
    return new Date(iso).toLocaleString(lang === 'id' ? 'id-ID' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

interface Props {
  chain: ChainConfigResponse;
  me: MeResponse | null;
  onClose(): void;
  refresh(): Promise<MeResponse | null>;
  toast(text: string): void;
  openSignIn(): void;
}

export default function WalletSheet({ chain, me, onClose, refresh, toast, openSignIn }: Props) {
  const [st, setSt] = useState<ChainStatusResponse | null>(null);
  const [blocked, setBlocked] = useState(chain.blocked);
  const [dep, setDep] = useState('');
  const [picking, setPicking] = useState(false);
  const [wd, setWd] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const alive = useRef(true);
  const t = useT('wallet', walletEn);
  const tc = useT('common', commonEn);
  const lang = useLang();
  const errs = useErrors();
  /** WalletProblem messages are English; show the translation of a known one. */
  const problem = (m: string): string => {
    const k = (Object.keys(walletEn) as (keyof typeof walletEn)[]).find((key) => key.startsWith('p.') && walletEn[key] === m);
    return k ? t(k) : m;
  };
  const u = me?.user;
  const signedIn = !!u && !u.guest;
  const wallet = me?.chain?.wallet ?? null;

  const load = useCallback(async (): Promise<ChainStatusResponse | null> => {
    try {
      const s = await api.chainStatus();
      if (!alive.current) return s;
      setSt(s);
      if (s.credited > 0) {
        toast(t('credited', { n: fmt(s.credited) }));
        void refresh();
      }
      return s;
    } catch {
      return null;
    }
  }, [refresh, toast, t]);

  useEffect(() => {
    alive.current = true;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    // The country is judged per request, so ask again from the browser.
    api.chainConfig().then(
      (c) => alive.current && setBlocked(c.blocked),
      () => undefined,
    );
    return () => {
      alive.current = false;
      removeEventListener('keydown', k);
    };
  }, [onClose]);

  useEffect(() => {
    if (!signedIn) return;
    void load();
    if (wallet) void txLib(); // warm the Solana chunk while the player reads the sheet
  }, [signedIn, wallet, load]);

  // While something is settling, look again every couple of seconds.
  const settling = !!st && (st.pendingOps > 0 || !!st.openWithdrawal);
  useEffect(() => {
    if (!settling) return;
    const t = setInterval(() => {
      void load().then((s) => {
        if (s && s.pendingOps === 0 && !s.openWithdrawal) void refresh();
      });
    }, 2500);
    return () => clearInterval(t);
  }, [settling, load, refresh]);

  const run = async (key: string, f: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setNote('');
    try {
      await f();
    } catch (e) {
      const lib = await txLib().catch(() => null);
      if (e instanceof ApiFailure) toast(errs.text(e));
      else if (lib && e instanceof lib.WalletProblem) toast(problem(e.message));
      else toast(t('incomplete'));
    } finally {
      if (alive.current) {
        setBusy('');
        setNote('');
      }
      await load();
      await refresh();
    }
  };

  const provider = (): (TxProvider & ReturnType<typeof solanaProvider>) | null => solanaProvider() as (TxProvider & ReturnType<typeof solanaProvider>) | null;
  const noWallet = (): void => toast(t('noWallet'));

  const link = () =>
    run('link', async () => {
      const sol = solanaProvider();
      if (!sol) return noWallet();
      const address = (await sol.connect()).publicKey.toBase58();
      const { message } = await api.walletNonce(address);
      // A signed text message proves the wallet is yours. It is not a transaction.
      const signed = await sol.signMessage(new TextEncoder().encode(message), 'utf8');
      await api.walletLink({ address, signature: bs58.encode(signed.signature) });
      toast(t('linked'));
    });

  const deposit = () =>
    run('deposit', async () => {
      const amount = whole(dep);
      if (!amount) return toast(t('whole'));
      const sol = provider();
      if (!sol || !wallet) return noWallet();
      const lib = await txLib();
      setNote(t('confirmDeposit'));
      const signature = await lib.sendDeposit(chain, sol, wallet, amount);
      setNote(t('depositSent'));
      for (let i = 0; ; i++) {
        try {
          const r = await api.depositConfirm(signature);
          toast(t('deposited', { n: fmt(r.amount) }));
          break;
        } catch (e) {
          // 404: the API's node has not seen the transaction yet.
          if (!(e instanceof ApiFailure && e.status === 404) || i >= 12) throw e;
          await sleep(1500);
        }
      }
      setDep('');
    });

  const withdraw = () =>
    run('withdraw', async () => {
      const amount = whole(wd);
      if (!amount) return toast(t('whole'));
      const sol = provider();
      if (!sol || !wallet) return noWallet();
      const lib = await txLib();
      const p = await api.withdrawPrepare(amount);
      setNote(t('confirmWithdraw'));
      const signedTx = await lib.signWithdrawal(sol, wallet, p.transaction);
      setNote(t('sendingWithdraw'));
      const r = await api.withdrawSubmit(p.withdrawId, signedTx);
      if (r.status === 'confirmed') toast(t('withdrew', { n: fmt(amount) }));
      else if (r.status === 'submitted') toast(t('withdrawSent'));
      else toast(t('withdrawFailed'));
      setWd('');
    });

  const faucet = () =>
    run('faucet', async () => {
      const r = await api.faucet();
      toast(t('faucetSent', { n: fmt(r.amount) }));
    });

  const status = note
    ? note
    : st?.hold
      ? t('hold')
      : st?.openWithdrawal
        ? st.openWithdrawal.status === 'submitted'
          ? t('wdConfirming', { n: fmt(st.openWithdrawal.amount) })
          : t('wdWaiting', { n: fmt(st.openWithdrawal.amount) })
        : st && st.pendingOps > 0
          ? t('settling')
          : '';

  return (
    <div className="scrim on" id="walletS" role="dialog" aria-modal="true" aria-label={t('title')} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label={tc('close')} onClick={onClose}>
          ✕
        </button>
        <h3>{t('title')}</h3>
        <p className="sub">{t('sub', { cluster: chain.cluster === 'devnet' ? 'devnet' : 'localnet' })}</p>
        {blocked && <p className="warn">{t('blocked')}</p>}
        {!signedIn ? (
          <>
            <p className="sub">{t('signInSub')}</p>
            <button className="btn go" onClick={openSignIn}>
              {t('signIn')}
            </button>
          </>
        ) : !wallet ? (
          <>
            <p className="sub">{t('linkSub')}</p>
            <button className="btn go" onClick={() => setPicking(true)} disabled={!!busy}>
              {t('link')}
            </button>
          </>
        ) : (
          <>
            <div className="kv">
              <span>{t('wallet')}</span>
              <b className="num" title={wallet}>
                {shortAddress(wallet)}
              </b>
            </div>
            <div className="kv">
              <span>{t('inGame')}</span>
              <b className="num">{fmt(u?.balance ?? 0)}</b>
            </div>
            <div className="kv">
              <span>{t('withdrawable')}</span>
              <b className="num">{st ? fmt(st.withdrawable) : '…'}</b>
            </div>
            <div className="kv">
              <span>{st?.onchain.unlockAt ? t('vestingUnlocks', { when: when(st.onchain.unlockAt, lang) }) : t('vesting')}</span>
              <b className="num">{st ? fmt(st.onchain.locked) : '…'}</b>
            </div>
            {!blocked && (
              <>
                <div className="lbl">{t('depositLbl')}</div>
                <form
                  className="field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void deposit();
                  }}
                >
                  <input inputMode="numeric" pattern="[0-9]*" maxLength={9} placeholder="500" aria-label={t('depositAria')} value={dep} onChange={(e) => setDep(e.target.value.replace(/\D/g, ''))} />
                  <button className="sbtn" disabled={!!busy}>
                    {t('deposit')}
                  </button>
                </form>
                <div className="lbl">{t('withdrawLbl')}</div>
                <form
                  className="field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void withdraw();
                  }}
                >
                  <input inputMode="numeric" pattern="[0-9]*" maxLength={9} placeholder={st ? String(st.withdrawable) : '0'} aria-label={t('withdrawAria')} value={wd} onChange={(e) => setWd(e.target.value.replace(/\D/g, ''))} />
                  <button className="sbtn" disabled={!!busy || !st || st.withdrawable < 1 || st.hold}>
                    {t('withdraw')}
                  </button>
                </form>
                {chain.faucet && (
                  <button className="btn alt" onClick={faucet} disabled={!!busy}>
                    {t('faucet', { n: fmt(chain.faucetAmount) })}
                  </button>
                )}
              </>
            )}
            <p className="fine" role="status" aria-live="polite">
              {status}
            </p>
          </>
        )}
        <p className="fine">
          {t('fine', { delay: durationIn(tc, chain.vestSeconds) })}
        </p>
      </div>
      {picking && (
        <WalletPicker
          onClose={() => setPicking(false)}
          onPick={() => {
            setPicking(false);
            void link();
          }}
        />
      )}
    </div>
  );
}

'use client';
// Chain mode only (devnet / local validator, TEST token with no value). The header's "Wallet"
// button opens this sheet. It is its own chunk, and the Solana libraries are another one that is
// fetched from here (lib/chain-tx), so the main bundle carries none of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import bs58 from 'bs58';
import { fmt } from '@podium/shared';
import type { ChainConfigResponse, ChainStatusResponse, MeResponse } from '@podium/shared';
import { api, ApiFailure, errorText } from '@/lib/api';
import { durationText, shortAddress } from '@/lib/chain';
import type { TxProvider } from '@/lib/chain-tx';
import { solanaProvider } from '@/lib/wallets';
import WalletPicker from './WalletPicker';

const txLib = () => import('@/lib/chain-tx');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const whole = (v: string): number | null => (/^[1-9]\d{0,8}$/.test(v.trim()) ? Number(v.trim()) : null);

const when = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
  const u = me?.user;
  const signedIn = !!u && !u.guest;
  const wallet = me?.chain?.wallet ?? null;

  const load = useCallback(async (): Promise<ChainStatusResponse | null> => {
    try {
      const s = await api.chainStatus();
      if (!alive.current) return s;
      setSt(s);
      if (s.credited > 0) {
        toast(`${fmt(s.credited)} tChips from an earlier deposit were added.`);
        void refresh();
      }
      return s;
    } catch {
      return null;
    }
  }, [refresh, toast]);

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
      if (e instanceof ApiFailure) toast(errorText(e));
      else if (lib && e instanceof lib.WalletProblem) toast(e.message);
      else toast('The wallet did not complete that. Nothing was moved.');
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
  const noWallet = (): void => toast('No Solana wallet found in this browser. Install one, switch it to Devnet and reload.');

  const link = () =>
    run('link', async () => {
      const sol = solanaProvider();
      if (!sol) return noWallet();
      const address = (await sol.connect()).publicKey.toBase58();
      const { message } = await api.walletNonce(address);
      // A signed text message proves the wallet is yours. It is not a transaction.
      const signed = await sol.signMessage(new TextEncoder().encode(message), 'utf8');
      await api.walletLink({ address, signature: bs58.encode(signed.signature) });
      toast('Wallet linked.');
    });

  const deposit = () =>
    run('deposit', async () => {
      const amount = whole(dep);
      if (!amount) return toast('Enter a whole number of tChips.');
      const sol = provider();
      if (!sol || !wallet) return noWallet();
      const lib = await txLib();
      setNote('Confirm the deposit in your wallet.');
      const signature = await lib.sendDeposit(chain, sol, wallet, amount);
      setNote('Deposit sent. Waiting for the game to see it.');
      for (let i = 0; ; i++) {
        try {
          const r = await api.depositConfirm(signature);
          toast(`Deposited ${fmt(r.amount)} tChips.`);
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
      if (!amount) return toast('Enter a whole number of tChips.');
      const sol = provider();
      if (!sol || !wallet) return noWallet();
      const lib = await txLib();
      const p = await api.withdrawPrepare(amount);
      setNote('Confirm the withdrawal in your wallet.');
      const signedTx = await lib.signWithdrawal(sol, wallet, p.transaction);
      setNote('Sending the withdrawal.');
      const r = await api.withdrawSubmit(p.withdrawId, signedTx);
      if (r.status === 'confirmed') toast(`Withdrew ${fmt(amount)} tChips to your wallet.`);
      else if (r.status === 'submitted') toast('Withdrawal sent. It is still being confirmed.');
      else toast('The withdrawal did not go through. The tChips are back in your balance.');
      setWd('');
    });

  const faucet = () =>
    run('faucet', async () => {
      const r = await api.faucet();
      toast(`${fmt(r.amount)} test tokens were sent to your wallet. Deposit them to play.`);
    });

  const status = note
    ? note
    : st?.hold
      ? 'Withdrawals are on hold while this account is reviewed.'
      : st?.openWithdrawal
        ? st.openWithdrawal.status === 'submitted'
          ? `A withdrawal of ${fmt(st.openWithdrawal.amount)} tChips is being confirmed.`
          : `A withdrawal of ${fmt(st.openWithdrawal.amount)} tChips is waiting for your wallet. If it is not signed it returns to your balance in a minute or two.`
        : st && st.pendingOps > 0
          ? 'Your last plays are still settling. Withdrawals open in a moment.'
          : '';

  return (
    <div className="scrim on" id="walletS" role="dialog" aria-modal="true" aria-label="Wallet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h3>Wallet</h3>
        <p className="sub">tChips are a test token on Solana {chain.cluster === 'devnet' ? 'devnet' : 'localnet'}. It has no value.</p>
        {blocked && <p className="warn">Deposits, withdrawals and paid entries are not available in your country. Practice and the leaderboards stay open.</p>}
        {!signedIn ? (
          <>
            <p className="sub">Sign in with your wallet to deposit test tokens and play ranked.</p>
            <button className="btn go" onClick={openSignIn}>
              Sign in
            </button>
          </>
        ) : !wallet ? (
          <>
            <p className="sub">Link a wallet to this account. You sign a short message to prove it is yours; no transaction is made.</p>
            <button className="btn go" onClick={() => setPicking(true)} disabled={!!busy}>
              Link a wallet
            </button>
          </>
        ) : (
          <>
            <div className="kv">
              <span>Wallet</span>
              <b className="num" title={wallet}>
                {shortAddress(wallet)}
              </b>
            </div>
            <div className="kv">
              <span>In game</span>
              <b className="num">{fmt(u?.balance ?? 0)}</b>
            </div>
            <div className="kv">
              <span>Withdrawable now</span>
              <b className="num">{st ? fmt(st.withdrawable) : '…'}</b>
            </div>
            <div className="kv">
              <span>Vesting{st?.onchain.unlockAt ? `, unlocks ${when(st.onchain.unlockAt)}` : ''}</span>
              <b className="num">{st ? fmt(st.onchain.locked) : '…'}</b>
            </div>
            {!blocked && (
              <>
                <div className="lbl">Deposit, whole tChips</div>
                <form
                  className="field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void deposit();
                  }}
                >
                  <input inputMode="numeric" pattern="[0-9]*" maxLength={9} placeholder="500" aria-label="Deposit amount" value={dep} onChange={(e) => setDep(e.target.value.replace(/\D/g, ''))} />
                  <button className="sbtn" disabled={!!busy}>
                    Deposit
                  </button>
                </form>
                <div className="lbl">Withdraw to your wallet</div>
                <form
                  className="field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void withdraw();
                  }}
                >
                  <input inputMode="numeric" pattern="[0-9]*" maxLength={9} placeholder={st ? String(st.withdrawable) : '0'} aria-label="Withdraw amount" value={wd} onChange={(e) => setWd(e.target.value.replace(/\D/g, ''))} />
                  <button className="sbtn" disabled={!!busy || !st || st.withdrawable < 1 || st.hold}>
                    Withdraw
                  </button>
                </form>
                {chain.faucet && (
                  <button className="btn alt" onClick={faucet} disabled={!!busy}>
                    Get {fmt(chain.faucetAmount)} test tokens
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
          This is a test token on a test network. It has no value and cannot be exchanged for anything. Reward tChips can be played at once and withdrawn after {durationText(chain.vestSeconds)}.
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

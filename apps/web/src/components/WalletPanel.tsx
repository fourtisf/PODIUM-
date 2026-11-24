'use client';
// Profile: the linked Solana wallet (identity only), with connect and disconnect.
import { useState } from 'react';
import bs58 from 'bs58';
import { api, ApiFailure } from '@/lib/api';
import { disconnectWallet, selectedWalletOption, solanaProvider } from '@/lib/wallets';
import { useT } from '@/i18n/client';
import { profileEn } from '@/i18n/dict/profile.en';
import { useSession } from './Session';
import WalletPicker from './WalletPicker';

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function WalletPanel() {
  const s = useSession();
  const t = useT('profile', profileEn);
  const u = s.me?.user;
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const signedIn = !!u && !u.guest;
  const chainOn = !!s.chain;
  const opt = typeof window === 'undefined' ? undefined : selectedWalletOption();

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const sol = solanaProvider();
      if (!sol) return s.toast(t('wallet.noExt'));
      let address: string, signature: string;
      try {
        address = (await sol.connect()).publicKey.toBase58();
        const { message } = await api.walletNonce(address);
        // A signed text message proves the wallet is yours. It is not a transaction.
        signature = bs58.encode((await sol.signMessage(new TextEncoder().encode(message), 'utf8')).signature);
      } catch (e) {
        if (e instanceof ApiFailure) throw e;
        return s.toast(t('wallet.failed'));
      }
      await api.walletLink({ address, signature });
      await s.refresh();
      s.toast(t('wallet.linked'));
    });

  const disconnect = () =>
    run(async () => {
      if (!u?.wallet) return;
      if (u.canUnlinkWallet) {
        await api.walletUnlink();
        await disconnectWallet();
        await s.refresh();
        s.toast(t('wallet.removed'));
      } else {
        // The wallet is the account's only way in: disconnecting means signing out.
        await disconnectWallet();
        await s.signOut();
        s.toast(t('wallet.signedOut'));
      }
    });

  return (
    <>
      <h3>{t('wallet.title')}</h3>
      {!signedIn ? (
        <p className="fine">{t('wallet.signInFirst')}</p>
      ) : u?.wallet ? (
        <div className="wpanel">
          <div className="wrow">
            {opt ? <img src={opt.icon} alt="" width={28} height={28} /> : <span className="wdot" aria-hidden="true" />}
            <code title={u.wallet}>{short(u.wallet)}</code>
            {chainOn ? null : (
              <button className="sbtn lt" onClick={() => void disconnect()} disabled={busy}>
                {t('wallet.disconnect')}
              </button>
            )}
          </div>
          <p className="fine">{chainOn ? t('wallet.chainLocked') : u.canUnlinkWallet ? '' : t('wallet.onlyLogin')}</p>
        </div>
      ) : (
        <div className="wpanel">
          <p className="fine">{t('wallet.none')}</p>
          <button className="sbtn" onClick={() => setPicking(true)} disabled={busy}>
            {t('wallet.connect')}
          </button>
        </div>
      )}
      {picking && (
        <WalletPicker
          onClose={() => setPicking(false)}
          onPick={() => {
            setPicking(false);
            void link();
          }}
        />
      )}
    </>
  );
}

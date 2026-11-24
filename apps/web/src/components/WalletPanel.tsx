'use client';
// Profile: the linked Solana wallet (identity only), with connect and disconnect.
import { useState } from 'react';
import { selectedWalletOption } from '@/lib/wallets';
import { useWalletActions } from './useWalletActions';
import { useT } from '@/i18n/client';
import { commonEn } from '@/i18n/dict/common.en';
import { useSession } from './Session';
import WalletPicker from './WalletPicker';

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function WalletPanel() {
  const s = useSession();
  const t = useT('common', commonEn);
  const u = s.me?.user;
  const { busy, link, disconnect, chainOn } = useWalletActions();
  const [picking, setPicking] = useState(false);
  const signedIn = !!u && !u.guest;
  const opt = typeof window === 'undefined' ? undefined : selectedWalletOption();

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

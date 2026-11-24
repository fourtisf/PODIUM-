'use client';
// Connect and disconnect the account's Solana wallet (identity only). Shared by the header
// player menu and the profile wallet panel.
import { useState } from 'react';
import bs58 from 'bs58';
import { api, ApiFailure } from '@/lib/api';
import { disconnectWallet, solanaProvider } from '@/lib/wallets';
import { useT } from '@/i18n/client';
import { commonEn } from '@/i18n/dict/common.en';
import { useSession } from './Session';

export function useWalletActions() {
  const s = useSession();
  const t = useT('common', commonEn);
  const [busy, setBusy] = useState(false);
  const u = s.me?.user;

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

  /** Asks the picked wallet to sign the nonce message and links it to the signed-in account. */
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

  /**
   * Removes the wallet from an account that can also sign in by email or Google. When the wallet is
   * the only way in, disconnecting signs out instead (removing it would lock the player out).
   */
  const disconnect = () =>
    run(async () => {
      if (!u?.wallet) return;
      if (u.canUnlinkWallet) {
        await api.walletUnlink();
        await disconnectWallet();
        await s.refresh();
        s.toast(t('wallet.removed'));
      } else {
        await disconnectWallet();
        await s.signOut();
        s.toast(t('wallet.signedOut'));
      }
    });

  return { busy, link, disconnect, chainOn: !!s.chain };
}

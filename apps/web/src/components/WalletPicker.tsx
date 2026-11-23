'use client';

// "Connect a wallet": every supported wallet with its logo. Installed wallets connect; the others link to their download page.
import { useEffect, useState } from 'react';
import { WALLETS, hasOtherWallet, selectWallet, walletInstalled } from '@/lib/wallets';

export default function WalletPicker({ onPick, onClose }: { onPick(): void; onClose(): void }) {
  const [found, setFound] = useState<Record<string, boolean>>({});
  const [other, setOther] = useState(false);
  useEffect(() => {
    // Extensions inject after load, so look again shortly after opening.
    const scan = () => {
      setFound(Object.fromEntries(WALLETS.map((w) => [w.id, walletInstalled(w.id)])));
      setOther(hasOtherWallet());
    };
    scan();
    const t = setTimeout(scan, 600);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => {
      clearTimeout(t);
      removeEventListener('keydown', k);
    };
  }, [onClose]);

  const sorted = [...WALLETS].sort((a, b) => Number(!!found[b.id]) - Number(!!found[a.id]));
  return (
    <div className="scrim on" id="walletpick" role="dialog" aria-modal="true" aria-label="Connect a wallet" style={{ zIndex: 60 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ position: 'relative' }}>
        <button className="x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="in">
          <h3>Connect a wallet</h3>
          <div className="wlist">
            {sorted.map((w) =>
              found[w.id] ? (
                <button
                  key={w.id}
                  className="mode alt wopt"
                  data-wallet={w.id}
                  onClick={() => {
                    selectWallet(w.id);
                    onPick();
                  }}
                >
                  <span className="wname">
                    <img src={w.icon} alt="" width={32} height={32} />
                    <b>{w.name}</b>
                  </span>
                  <small>Detected</small>
                </button>
              ) : (
                <a key={w.id} className="mode alt wopt" data-wallet={w.id} href={w.url} target="_blank" rel="noopener noreferrer">
                  <span className="wname">
                    <img src={w.icon} alt="" width={32} height={32} />
                    <b>{w.name}</b>
                  </span>
                  <small>Install</small>
                </a>
              ),
            )}
            {other && (
              <button className="mode alt wopt" data-wallet="other" onClick={onPick}>
                <span className="wname">
                  <span className="wgen" aria-hidden="true">
                    <svg viewBox="0 0 20 20" width="18" height="18">
                      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H15v3M3 6.5V14a2 2 0 0 0 2 2h12V7H5.5A2.5 2.5 0 0 1 3 6.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <circle cx="13.6" cy="11.5" r="1.1" fill="currentColor" />
                    </svg>
                  </span>
                  <b>Browser wallet</b>
                </span>
                <small>Detected</small>
              </button>
            )}
          </div>
          <p className="fine" style={{ margin: '12px 0 0' }}>
            A wallet proves who you are by signing a short message. tChips are test chips with no value.
          </p>
        </div>
      </div>
    </div>
  );
}

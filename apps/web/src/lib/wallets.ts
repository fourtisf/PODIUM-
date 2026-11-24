// Solana wallets the site can connect to. A wallet is used to sign a text message (identity) and,
// in chain mode on devnet, to sign deposit and withdrawal transactions. Logos are the wallets' own
// icons as published in the Apache-2.0 @solana/wallet-adapter packages, stored in /public/wallets.

/** What the rest of the app needs from a wallet. connect() always resolves to the wallet's public key. */
export interface SolanaProvider {
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, display?: 'utf8'): Promise<{ signature: Uint8Array }>;
}

/** The injected object as wallets actually ship it; shapes differ slightly between wallets. */
interface RawProvider {
  connect(...args: unknown[]): Promise<unknown>;
  signMessage(message: Uint8Array, display?: string): Promise<unknown>;
  publicKey?: { toBase58(): string } | null;
  [key: string]: unknown;
}

export interface WalletOption {
  id: string;
  name: string;
  /** Path of the logo under /public. */
  icon: string;
  /** Where to get the wallet when it is not installed. */
  url: string;
  find(w: Record<string, unknown>): unknown;
}

const at = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);

export const WALLETS: WalletOption[] = [
  { id: 'phantom', name: 'Phantom', icon: '/wallets/phantom.svg', url: 'https://phantom.app/download', find: (w) => at(w.phantom, 'solana') },
  { id: 'solflare', name: 'Solflare', icon: '/wallets/solflare.svg', url: 'https://solflare.com/download', find: (w) => w.solflare },
  { id: 'backpack', name: 'Backpack', icon: '/wallets/backpack.png', url: 'https://backpack.app/download', find: (w) => at(w.backpack, 'solana') ?? w.backpack },
  { id: 'coinbase', name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg', url: 'https://www.coinbase.com/wallet/downloads', find: (w) => w.coinbaseSolana },
  { id: 'trust', name: 'Trust Wallet', icon: '/wallets/trust.svg', url: 'https://trustwallet.com/download', find: (w) => at(w.trustwallet, 'solana') },
];

const usable = (p: unknown): p is RawProvider =>
  !!p && typeof (p as RawProvider).connect === 'function' && typeof (p as RawProvider).signMessage === 'function';

const win = (): Record<string, unknown> | null => (typeof window === 'undefined' ? null : (window as unknown as Record<string, unknown>));

function raw(id: string): RawProvider | null {
  const w = win();
  const opt = WALLETS.find((x) => x.id === id);
  if (!w || !opt) return null;
  const p = opt.find(w);
  return usable(p) ? p : null;
}

/** True when that wallet's extension is present in this browser. */
export const walletInstalled = (id: string): boolean => raw(id) !== null;

const KEY = 'podium.wallet';
export function selectedWallet(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function selectWallet(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: the choice just is not remembered */
  }
}

/** Wraps an injected provider so every wallet answers the same way. Other methods (signTransaction, ...) pass through. */
function normalise(p: RawProvider): SolanaProvider {
  return new Proxy(p, {
    get(target, prop) {
      if (prop === 'connect') {
        return async () => {
          const r = await target.connect();
          const pk = (at(r, 'publicKey') as RawProvider['publicKey']) ?? target.publicKey;
          if (!pk || typeof pk.toBase58 !== 'function') throw new Error('The wallet did not share an address.');
          return { publicKey: pk };
        };
      }
      if (prop === 'signMessage') {
        return async (message: Uint8Array, display?: string) => {
          const r = await target.signMessage(message, display);
          // Most wallets return { signature }; a few return the bytes themselves.
          const sig = r instanceof Uint8Array ? r : (at(r, 'signature') as Uint8Array | undefined);
          if (!sig) throw new Error('The wallet did not sign the message.');
          return { signature: sig };
        };
      }
      const v = target[prop as string];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as SolanaProvider;
}

/**
 * The wallet to use: the one the player picked if it is installed, otherwise the first installed
 * one from the list, otherwise a generic injected `window.solana`.
 */
export function solanaProvider(): SolanaProvider | null {
  const w = win();
  if (!w) return null;
  const picked = selectedWallet();
  const order = picked ? [picked, ...WALLETS.map((x) => x.id).filter((id) => id !== picked)] : WALLETS.map((x) => x.id);
  for (const id of order) {
    const p = raw(id);
    if (p) return normalise(p);
  }
  return usable(w.solana) ? normalise(w.solana) : null;
}

/** A wallet that is injected as plain `window.solana` and is none of the listed ones. */
export const hasOtherWallet = (): boolean => {
  const w = win();
  return !!w && usable(w.solana) && !WALLETS.some((x) => raw(x.id) === w.solana) && !WALLETS.some((x) => walletInstalled(x.id));
};

/** The listed wallet the player last picked, if any (for showing its logo). */
export const selectedWalletOption = (): WalletOption | undefined => {
  const id = selectedWallet();
  return id ? WALLETS.find((w) => w.id === id) : undefined;
};

/** Disconnects the site from the wallet extension (where it supports that) and forgets the choice. */
export async function disconnectWallet(): Promise<void> {
  const w = win();
  const ids = WALLETS.map((x) => x.id);
  for (const id of ids) {
    const p = raw(id);
    try {
      if (p && typeof p.disconnect === 'function') await (p.disconnect as () => Promise<unknown>)();
    } catch {
      /* the extension refused or is already disconnected */
    }
  }
  try {
    const s = w?.solana as RawProvider | undefined;
    if (s && typeof s.disconnect === 'function') await (s.disconnect as () => Promise<unknown>)();
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

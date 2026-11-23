// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { WALLETS, hasOtherWallet, selectWallet, solanaProvider, walletInstalled } from './wallets';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const pk = (s: string) => ({ toBase58: () => s });
const g = globalThis as unknown as { window?: Record<string, unknown>; localStorage?: unknown };

function install(win: Record<string, unknown>): void {
  const store = new Map<string, string>();
  g.window = win;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
}
afterEach(() => {
  delete g.window;
  delete g.localStorage;
});

describe('wallets', () => {
  it('every listed wallet has a logo file and a download link', () => {
    expect(WALLETS.length).toBeGreaterThanOrEqual(5);
    for (const w of WALLETS) {
      expect(existsSync(join(__dirname, '../../public', w.icon)), w.icon).toBe(true);
      expect(w.url.startsWith('https://')).toBe(true);
    }
  });

  it('detects installed wallets and uses the picked one', async () => {
    const mk = (addr: string) => ({ connect: async () => ({ publicKey: pk(addr) }), signMessage: async () => ({ signature: new Uint8Array([1]) }) });
    install({ phantom: { solana: mk('PHANTOM') }, solflare: mk('SOLFLARE') });
    expect(walletInstalled('phantom')).toBe(true);
    expect(walletInstalled('trust')).toBe(false);
    expect((await solanaProvider()!.connect()).publicKey.toBase58()).toBe('PHANTOM');
    selectWallet('solflare');
    expect((await solanaProvider()!.connect()).publicKey.toBase58()).toBe('SOLFLARE');
    selectWallet('trust'); // picked but not installed: fall back to an installed one
    expect((await solanaProvider()!.connect()).publicKey.toBase58()).toBe('PHANTOM');
  });

  it('normalises wallets whose connect() returns nothing and whose signMessage returns bytes', async () => {
    const sig = new Uint8Array([7, 8]);
    install({ solflare: { publicKey: pk('SF'), connect: async () => true, signMessage: async () => sig, signTransaction: function (this: unknown) { return this; } } });
    const p = solanaProvider()!;
    expect((await p.connect()).publicKey.toBase58()).toBe('SF');
    expect((await p.signMessage(new Uint8Array())).signature).toBe(sig);
    // Other methods pass through, bound to the real provider.
    expect((p as unknown as { signTransaction(): unknown }).signTransaction()).toBe((g.window as { solflare: unknown }).solflare);
  });

  it('falls back to a generic injected wallet, and to null when there is none', () => {
    install({ solana: { connect: async () => ({ publicKey: pk('X') }), signMessage: async () => ({ signature: new Uint8Array() }) } });
    expect(hasOtherWallet()).toBe(true);
    expect(solanaProvider()).not.toBeNull();
    install({});
    expect(hasOtherWallet()).toBe(false);
    expect(solanaProvider()).toBeNull();
  });
});

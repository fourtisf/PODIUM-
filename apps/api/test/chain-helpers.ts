// Helpers for the chain-mode tests. They run the REAL built program in-process (LiteSVM, through
// the same interface the server uses for RPC), with a valueless test mint.
import { createPrivateKey, sign } from 'node:crypto';
import { liabilities } from '@podium/chain';
import { TEST_BUILD_HINT, TEST_PROGRAM_BUILT, TestChain, type TestChainOptions } from '@podium/chain/testing';
import type { AuthResponse, DepositConfirmResponse } from '@podium/shared';
import type { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { expect } from 'vitest';
import { drainChainOps, type DrainReport } from '../src/chain/outbox';
import type { ChainSettings } from '../src/config';
import { Client, freshApp, makeApp, visitor, type Res, type TestApp } from './helpers';

export const CHAIN_READY = TEST_PROGRAM_BUILT;
if (!CHAIN_READY) console.warn(TEST_BUILD_HINT);

export interface ChainTest extends TestApp {
  world: TestChain;
  /** Users whose ledger is knowingly out of step with the chain in a test (a rejected operation). */
  outOfStep: Set<string>;
}

export const keyJson = (kp: Keypair): string => JSON.stringify([...kp.secretKey]);

export function chainSettings(world: TestChain, over: Partial<ChainSettings> = {}): ChainSettings {
  return {
    mode: 'localnet', rpcUrl: '', programId: world.programId.toBase58(), mint: world.mint.toBase58(), operatorKeypair: keyJson(world.operatorKp),
    faucetKeypair: '', faucetAmount: 5000, blockedCountries: [], allowedCountries: [], geoHeader: 'cf-ipcountry', ...over,
  };
}

/** An empty database and a chain-mode app on a fresh in-process chain whose clock follows the app's clock. */
export async function chainApp(opts: { chain?: TestChainOptions; settings?: Partial<ChainSettings>; faucet?: boolean } = {}): Promise<ChainTest> {
  await (await freshApp()).close(); // empties the database and Redis
  const world = await TestChain.create(opts.chain);
  // The test mint's authority is the faucet key, as CHAIN_FAUCET_KEYPAIR would be on devnet.
  const settings = chainSettings(world, { ...(opts.faucet ? { faucetKeypair: keyJson(world.admin) } : {}), ...opts.settings });
  const t = (await makeApp({ chainRpc: world.rpc, config: { chain: settings } })) as ChainTest;
  world.rpc.follow = () => +t.now() / 1000;
  t.world = world;
  t.outOfStep = new Set();
  const close = t.close;
  t.close = async () => {
    await close();
    await world.close();
  };
  return t;
}

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
/** What a wallet's signMessage returns, base58. */
export function signMessage(kp: Keypair, message: string): string {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(kp.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
  return bs58.encode(sign(null, Buffer.from(message, 'utf8'), key));
}

export class WalletClient extends Client {
  kp!: Keypair;
  get address(): string {
    return this.kp.publicKey.toBase58();
  }
}

async function proof(c: Client, kp: Keypair): Promise<{ address: string; signature: string }> {
  const address = kp.publicKey.toBase58();
  const n = await c.post<{ message: string }>('/auth/wallet/nonce', { address });
  if (n.status !== 200) throw new Error('nonce → ' + JSON.stringify(n.body));
  return { address, signature: signMessage(kp, n.body.message) };
}

/** Signs up with a new wallet through the real sign-message flow. `tokens` test chips are minted to the wallet first. */
export async function walletUser(t: ChainTest, o: { tokens?: number; deposit?: number; name?: string; ref?: string; unlocked?: boolean; headers?: Record<string, string> } = {}): Promise<WalletClient> {
  const c = new WalletClient(t);
  await c.start();
  c.kp = await t.world.wallet(o.tokens ?? o.deposit ?? 0);
  const r = await c.post<AuthResponse>('/auth/wallet/verify', { ...(await proof(c, c.kp)), adult: true, name: o.name, ref: o.ref });
  if (r.status !== 200) throw new Error('wallet verify → ' + JSON.stringify(r.body));
  c.id = r.body.userId;
  c.name = r.body.name;
  if (o.unlocked) await t.ctx.db.user.update({ where: { id: c.id }, data: { validatedRanked: 99 } });
  if (o.deposit) {
    const d = await deposit(t, c, o.deposit, { headers: o.headers });
    if (d.status !== 200) throw new Error('deposit → ' + JSON.stringify(d.body));
  }
  return c;
}

export const linkWallet = async (c: Client, kp: Keypair): Promise<Res<AuthResponse>> => c.post<AuthResponse>('/auth/wallet/link', await proof(c, kp));

/** Sends the deposit a browser would send, then reports its signature to the API. */
export async function deposit(t: ChainTest, c: WalletClient, chips: number, o: { headers?: Record<string, string> } = {}): Promise<Res<DepositConfirmResponse> & { signature: string }> {
  const signature = await t.world.deposit(c.kp, t.ctx.chain!.toBase(chips));
  return { ...(await c.post<DepositConfirmResponse>('/chain/deposit/confirm', { signature }, o)), signature };
}

/** Runs the outbox until it is empty and fails the test if an operation had to wait. */
export async function drain(t: ChainTest): Promise<DrainReport> {
  const r = await drainChainOps(t.ctx);
  expect(r.ran).toBe(true);
  expect(r.stalled).toBeNull();
  return r;
}

/** Whole tChips the wallet holds in the program (available + vesting). */
export async function onChain(t: ChainTest, c: WalletClient): Promise<number> {
  const p = await t.world.player(c.kp.publicKey);
  return p ? t.ctx.chain!.toChips(p.available + p.locked) : 0;
}

/**
 * The invariant of chain mode, for EVERY user: ledger balance (plus what an open withdrawal has
 * reserved) == on-chain available + locked, to the base unit; accounts without a wallet hold
 * nothing; and the vault covers the program's whole ledger.
 */
export async function assertParity(t: ChainTest): Promise<void> {
  await drain(t);
  const chain = t.ctx.chain!;
  expect(await t.ctx.db.chainOp.count({ where: { status: { in: ['pending', 'sent'] } } })).toBe(0);
  const users = await t.ctx.db.user.findMany({ include: { withdrawals: { where: { status: { in: ['prepared', 'submitted'] } } } } });
  for (const u of users) {
    if (t.outOfStep.has(u.id)) continue;
    const reserved = u.withdrawals.reduce((a, w) => a + w.amount, 0);
    if (!u.wallet) {
      expect(u.balance, `${u.name} has no wallet`).toBe(0);
      continue;
    }
    const p = await chain.player(u.wallet);
    const base = p ? p.available + p.locked : 0n;
    expect(base % chain.unit, `${u.name}: whole tChips on-chain`).toBe(0n);
    expect(u.balance + reserved, `${u.name}: ledger vs chain`).toBe(chain.toChips(base));
  }
  const cfg = await t.world.config();
  expect(await t.world.vaultBalance()).toBe(liabilities(cfg));
  // Everything players hold on-chain belongs to a user we know.
  const held = users.filter((u) => u.wallet && !t.outOfStep.has(u.id)).reduce((a, u) => a + u.balance + u.withdrawals.reduce((x, w) => x + w.amount, 0), 0);
  if (t.outOfStep.size === 0) expect(chain.toChips(cfg.totalPlayerBalance)).toBe(held);
}

export { visitor };

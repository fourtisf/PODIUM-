// TEST HELPER ONLY (Node, needs the dev dependency litesvm). Not exported from the package index.
// An in-process chain with the BUILT Podium program loaded, a valueless test mint, an initialized
// config and a funded rewards pot, plus an RPC stand-in that offers what a server needs from
// web3.js `Connection`: the Operator's ChainConnection and a few read calls.
//
// LiteSVM itself runs in a worker thread (testing-worker.cjs explains why), so every call here is async.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { decodeConfig, decodeDuel, decodePlayer, decodePool, type ConfigAccount, type DuelAccount, type PlayerAccount, type PoolAccount } from './accounts';
import { DEFAULT_BURN_BPS, DEFAULT_FEE_BPS, DEFAULT_UNIT, DEFAULT_VEST_SECONDS, LOCAL_TEST_PROGRAM_ID } from './constants';
import { buildFundRewardsIx, buildInitializeIx, buildSetPausedIx } from './instructions';
import type { ChainConnection } from './operator';
import { configPda, duelPda, playerPda, poolPda, vaultPda } from './pda';
import { buildDepositTx } from './tx';
import { toBase } from './units';

const here = dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = resolve(here, '../../../programs/podium/target/deploy');
export const TEST_SO_PATH = resolve(DEPLOY_DIR, 'podium.so');
export const TEST_PROGRAM_BUILT = existsSync(TEST_SO_PATH);
export const TEST_BUILD_HINT =
  `Chain tests SKIPPED: ${TEST_SO_PATH} is missing. Build it with ` +
  '`pnpm --filter @podium/chain build:program` (needs the Agave CLI on PATH).';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** How long a blockhash stays valid, in blocks (as on a real cluster). */
export const TEST_BLOCKHASH_BLOCKS = 150;

/** The LiteSVM worker: one request at a time, answered in order. */
class Vm {
  private readonly worker = new Worker(resolve(here, 'testing-worker.cjs'));
  private readonly waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private next = 1;
  constructor() {
    this.worker.unref();
    this.worker.on('message', (m: { id: number; result?: unknown; error?: string }) => {
      const w = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (m.error !== undefined) w?.reject(new Error(m.error));
      else w?.resolve(m.result);
    });
    this.worker.on('error', (e) => {
      for (const w of this.waiting.values()) w.reject(e);
      this.waiting.clear();
    });
  }
  call<T>(op: string, ...args: unknown[]): Promise<T> {
    const id = this.next++;
    return new Promise<T>((res, rej) => {
      this.waiting.set(id, { resolve: res as (v: unknown) => void, reject: rej });
      this.worker.postMessage({ id, op, args });
    });
  }
  close(): Promise<number> {
    return this.worker.terminate();
  }
}

/** RPC stand-in backed by LiteSVM. Every sent transaction is one block. */
export class TestRpc implements ChainConnection {
  /** Block height; a test raises it to let blockhashes expire. */
  height = 1000;
  sent = 0;
  lastLogs: string[] = [];
  /** Test hooks: the next sends throw before anything is sent, as an unreachable node would. */
  failSends = 0;
  /** Test hook: the next sends LAND and then the answer is lost. */
  loseAnswers = 0;
  /** Test hook: the next confirmations throw (the transaction has landed). */
  dropConfirmations = 0;
  /** When set, the chain clock follows this (unix seconds) before every transaction and read. */
  follow: (() => number) | null = null;
  private readonly validUntil = new Map<string, number>();
  private readonly txs = new Map<string, { ok: boolean; logs: string[] }>();
  private readonly byAddress = new Map<string, string[]>();

  private clock: bigint | null = null;

  constructor(private readonly vm: Vm) {}

  private async tick(): Promise<void> {
    if (!this.follow) return;
    const t = BigInt(Math.floor(this.follow()));
    if (this.clock !== t) await this.vm.call('setClock', t);
    this.clock = t;
  }

  /** Sets the chain clock (unix seconds). Ignored while `follow` is set. */
  async setTime(unix: number | bigint): Promise<void> {
    this.clock = BigInt(Math.floor(Number(unix)));
    await this.vm.call('setClock', this.clock);
  }

  /** Raw account bytes, or null. */
  async account(address: PublicKey): Promise<{ data: Buffer; owner: PublicKey } | null> {
    const a = await this.vm.call<{ data: Uint8Array; owner: string } | null>('getAccount', address.toBase58());
    return a ? { data: Buffer.from(a.data), owner: new PublicKey(a.owner) } : null;
  }

  /** Test hook: a new blockhash without a transaction. */
  expireBlockhash(): Promise<void> {
    return this.vm.call('expireBlockhash');
  }

  async getGenesisHash(): Promise<string> {
    return 'LiteSVMTestGenesis11111111111111111111111111';
  }
  getAccountInfo(address: PublicKey) {
    return this.account(address);
  }
  async getLatestBlockhash() {
    const blockhash = await this.vm.call<string>('latestBlockhash');
    const lastValidBlockHeight = this.height + TEST_BLOCKHASH_BLOCKS;
    if (!this.validUntil.has(blockhash)) this.validUntil.set(blockhash, lastValidBlockHeight);
    return { blockhash, lastValidBlockHeight: this.validUntil.get(blockhash)! };
  }
  async sendRawTransaction(raw: Buffer | Uint8Array | number[]): Promise<string> {
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error('connect ECONNREFUSED (test)');
    }
    const tx = Transaction.from(Buffer.from(raw as Uint8Array));
    const until = this.validUntil.get(tx.recentBlockhash ?? '');
    if (until === undefined || this.height > until) throw new Error('Blockhash not found');
    await this.tick();
    const res = await this.vm.call<{ ok: boolean; logs: string[]; error?: string }>('send', Uint8Array.from(raw as Uint8Array));
    this.height++;
    this.sent++;
    this.lastLogs = res.logs;
    // Like a failed preflight simulation: nothing lands.
    if (!res.ok) throw Object.assign(new Error(res.error), { logs: res.logs });
    const signature = base58(tx.signature!);
    this.txs.set(signature, { ok: true, logs: this.lastLogs });
    for (const k of tx.compileMessage().accountKeys) {
      const list = this.byAddress.get(k.toBase58()) ?? [];
      list.unshift(signature);
      this.byAddress.set(k.toBase58(), list);
    }
    if (this.loseAnswers > 0) {
      this.loseAnswers--;
      throw new Error('socket hang up (test)');
    }
    return signature;
  }
  async confirmTransaction() {
    if (this.dropConfirmations > 0) {
      this.dropConfirmations--;
      throw new Error('socket hang up (test)');
    }
    return { value: { err: null } };
  }

  // ---- what the API server reads besides the Operator's needs
  async chainTime(): Promise<number> {
    await this.tick();
    return Number(await this.vm.call<bigint>('getClock'));
  }
  async finalizedHeight(): Promise<number> {
    return this.height;
  }
  async txInfo(signature: string): Promise<{ ok: boolean; logs: string[] } | null> {
    return this.txs.get(signature) ?? null;
  }
  async signaturesFor(address: PublicKey, limit: number): Promise<{ signature: string; ok: boolean }[]> {
    return (this.byAddress.get(address.toBase58()) ?? []).slice(0, limit).map((signature) => ({ signature, ok: true }));
  }
  async signatureStatus(signature: string): Promise<'ok' | 'failed' | null> {
    const t = this.txs.get(signature);
    return t ? (t.ok ? 'ok' : 'failed') : null;
  }
}

export interface TestChainOptions {
  /** Reward vesting delay in seconds. Default 7 days. */
  vestSeconds?: bigint | number;
  /** Chips put into the rewards pot. Default 1,000,000. */
  rewardsChips?: number;
}

/** The program, a test mint and an initialized config in LiteSVM. Build with `TestChain.create()`. */
export class TestChain {
  private readonly vm = new Vm();
  readonly rpc = new TestRpc(this.vm);
  readonly programId: PublicKey;
  /** Admin of the config and mint authority of the test mint (so it can act as the test faucet). */
  readonly admin = Keypair.generate();
  readonly operatorKp = Keypair.generate();
  readonly mintKp = Keypair.generate();
  readonly mint = this.mintKp.publicKey;
  readonly treasuryOwner = Keypair.generate().publicKey;
  treasuryWallet!: PublicKey;

  private constructor() {
    const idFile = resolve(DEPLOY_DIR, 'podium.program-id');
    this.programId = existsSync(idFile) ? new PublicKey(readFileSync(idFile, 'utf8').trim()) : LOCAL_TEST_PROGRAM_ID;
  }

  /** Stops the worker thread. */
  close(): Promise<number> {
    return this.vm.close();
  }

  static async create(opts: TestChainOptions = {}): Promise<TestChain> {
    const c = new TestChain();
    // Blockhash expiry is simulated by TestRpc (by block height), so a prepared transaction
    // survives other transactions being sent in between, as on a real cluster.
    await c.vm.call('addProgram', c.programId.toBase58(), TEST_SO_PATH);
    await c.airdrop(c.admin.publicKey, 1000);
    await c.airdrop(c.operatorKp.publicKey, 1000);
    await c.send(
      [
        SystemProgram.createAccount({
          fromPubkey: c.admin.publicKey,
          newAccountPubkey: c.mint,
          lamports: Number(await c.vm.call<bigint>('rent', MINT_SIZE)),
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(c.mint, 6, c.admin.publicKey, null),
      ],
      [c.admin, c.mintKp],
    );
    c.treasuryWallet = getAssociatedTokenAddressSync(c.mint, c.treasuryOwner);
    const adminAta = getAssociatedTokenAddressSync(c.mint, c.admin.publicKey);
    const rewards = toBase(opts.rewardsChips ?? 1_000_000, DEFAULT_UNIT);
    await c.send(
      [
        createAssociatedTokenAccountIdempotentInstruction(c.admin.publicKey, c.treasuryWallet, c.treasuryOwner, c.mint),
        createAssociatedTokenAccountIdempotentInstruction(c.admin.publicKey, adminAta, c.admin.publicKey, c.mint),
        buildInitializeIx(
          {
            admin: c.admin.publicKey,
            operator: c.operatorKp.publicKey,
            mint: c.mint,
            treasuryWallet: c.treasuryWallet,
            feeBps: DEFAULT_FEE_BPS,
            burnBps: DEFAULT_BURN_BPS,
            vestSeconds: opts.vestSeconds ?? DEFAULT_VEST_SECONDS,
            unit: DEFAULT_UNIT,
          },
          c.programId,
        ),
      ],
      [c.admin],
    );
    if (rewards > 0n) {
      await c.send([createMintToInstruction(c.mint, adminAta, c.admin.publicKey, rewards), buildFundRewardsIx(c.admin.publicKey, adminAta, rewards, c.programId)], [c.admin]);
    }
    return c;
  }

  /** Signs with `signers` (the first one pays) and sends. Returns the transaction signature. */
  async send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
    const tx = new Transaction();
    tx.feePayer = signers[0]!.publicKey;
    tx.recentBlockhash = (await this.rpc.getLatestBlockhash()).blockhash;
    tx.add(...ixs);
    tx.sign(...signers);
    return this.rpc.sendRawTransaction(tx.serialize());
  }

  airdrop(to: PublicKey, sol: number): Promise<void> {
    return this.vm.call('airdrop', to.toBase58(), BigInt(sol * LAMPORTS_PER_SOL));
  }

  /** A new wallet with SOL for fees and, when `chips` > 0, a token account holding that many test chips. */
  async wallet(chips = 0): Promise<Keypair> {
    const kp = Keypair.generate();
    await this.airdrop(kp.publicKey, 10);
    if (chips > 0) await this.mintTo(kp.publicKey, chips);
    return kp;
  }

  async mintTo(owner: PublicKey, chips: number): Promise<void> {
    const ata = getAssociatedTokenAddressSync(this.mint, owner, true);
    await this.send(
      [createAssociatedTokenAccountIdempotentInstruction(this.admin.publicKey, ata, owner, this.mint), createMintToInstruction(this.mint, ata, this.admin.publicKey, toBase(chips, DEFAULT_UNIT))],
      [this.admin],
    );
  }

  /** The deposit a browser would send: built with buildDepositTx and signed by the wallet. */
  async deposit(kp: Keypair, baseUnits: bigint, opts: { register?: boolean } = {}): Promise<string> {
    const { blockhash } = await this.rpc.getLatestBlockhash();
    const tx = buildDepositTx({ wallet: kp.publicKey, mint: this.mint, amount: baseUnits, recentBlockhash: blockhash, register: opts.register, programId: this.programId });
    tx.sign(kp);
    return this.rpc.sendRawTransaction(tx.serialize());
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.send([buildSetPausedIx(this.admin.publicKey, paused, this.programId)], [this.admin]);
  }

  /** Lets `blocks` blocks pass without transactions (blockhashes older than the window expire). */
  async passBlocks(blocks: number): Promise<void> {
    this.rpc.height += blocks;
    await this.rpc.expireBlockhash();
  }

  private async data(address: PublicKey): Promise<Buffer | null> {
    return (await this.rpc.account(address))?.data ?? null;
  }
  async config(): Promise<ConfigAccount> {
    return decodeConfig((await this.data(configPda(this.programId)))!);
  }
  async player(wallet: PublicKey): Promise<PlayerAccount | null> {
    const d = await this.data(playerPda(wallet, this.programId));
    return d ? decodePlayer(d) : null;
  }
  async pool(kind: number, game: string, periodStart: bigint | number): Promise<PoolAccount | null> {
    const d = await this.data(poolPda(kind, game, periodStart, this.programId));
    return d ? decodePool(d) : null;
  }
  async duel(id: string | Uint8Array): Promise<DuelAccount | null> {
    const d = await this.data(duelPda(id, this.programId));
    return d ? decodeDuel(d) : null;
  }
  private async tokens(tokenAccount: PublicKey): Promise<bigint> {
    const d = await this.data(tokenAccount);
    return d && d.length >= AccountLayout.span ? AccountLayout.decode(d).amount : 0n;
  }
  /** Base units in `owner`'s associated token account (0 when it does not exist). */
  tokenBalance(owner: PublicKey): Promise<bigint> {
    return this.tokens(getAssociatedTokenAddressSync(this.mint, owner, true));
  }
  treasuryWalletBalance(): Promise<bigint> {
    return this.tokens(this.treasuryWallet);
  }
  vaultBalance(): Promise<bigint> {
    return this.tokens(vaultPda(this.programId));
  }
  async supply(): Promise<bigint> {
    return MintLayout.decode((await this.data(this.mint))!).supply;
  }
}

// In-process test world: the BUILT program loaded into LiteSVM, a test mint, and helpers.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type Signer, type TransactionInstruction } from '@solana/web3.js';
import { Clock, FailedTransactionMetadata, LiteSVM } from 'litesvm';
import {
  DEFAULT_BURN_BPS,
  DEFAULT_FEE_BPS,
  DEFAULT_UNIT,
  LOCAL_TEST_PROGRAM_ID,
  Operator,
  buildDepositIx,
  buildInitializeIx,
  buildRegisterPlayerIx,
  decodeConfig,
  decodeDuel,
  decodePlayer,
  decodePool,
  configPda,
  duelPda,
  liabilities,
  playerPda,
  poolPda,
  setProgramId,
  toBase,
  toProgramError,
  vaultPda,
  type ChainConnection,
  type ConfigAccount,
  type DuelAccount,
  type PlayerAccount,
  type PoolAccount,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
export const DEPLOY_DIR = resolve(here, '../../../programs/podium/target/deploy');
export const SO_PATH = resolve(DEPLOY_DIR, 'podium.so');
export const PROGRAM_BUILT = existsSync(SO_PATH);
export const BUILD_HINT =
  `Podium program tests SKIPPED: ${SO_PATH} is missing. Build it with ` +
  '`pnpm --filter @podium/chain build:program` (needs the Agave CLI, see packages/chain/README.md).';

/** The id the .so was built with (the build script writes it next to the .so). */
export function builtProgramId(): PublicKey {
  const f = resolve(DEPLOY_DIR, 'podium.program-id');
  return existsSync(f) ? new PublicKey(readFileSync(f, 'utf8').trim()) : LOCAL_TEST_PROGRAM_ID;
}

export const VEST = 7n * 24n * 3600n;
export const T0 = 1_800_000_000n;
export const WEEK = 7n * 24n * 3600n;
export const chips = (n: number): bigint => toBase(n, DEFAULT_UNIT);

/** Just enough of web3.js `Connection` for the Operator class, backed by LiteSVM. */
export class LiteConnection implements ChainConnection {
  lastLogs: string[] = [];
  lastUnits = 0n;
  sent = 0;
  /** Test hook: make the next confirmations fail as a lost connection would (the tx still lands). */
  dropConfirmations = 0;
  constructor(readonly svm: LiteSVM) {}

  async getAccountInfo(address: PublicKey) {
    const a = this.svm.getAccount(address);
    return a ? { data: Buffer.from(a.data), owner: a.owner } : null;
  }
  async getLatestBlockhash() {
    return { blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: 0 };
  }
  async sendRawTransaction(raw: Buffer | Uint8Array | number[]) {
    const tx = Transaction.from(Buffer.from(raw as Uint8Array));
    const res = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    this.sent++;
    if (res instanceof FailedTransactionMetadata) {
      this.lastLogs = res.meta().logs();
      throw Object.assign(new Error(res.toString()), { logs: this.lastLogs });
    }
    this.lastLogs = res.logs();
    this.lastUnits = res.computeUnitsConsumed();
    return Buffer.from(res.signature()).toString('hex');
  }
  async confirmTransaction() {
    if (this.dropConfirmations > 0) {
      this.dropConfirmations--;
      throw new Error('socket hang up');
    }
    return { value: { err: null } };
  }
}

export interface TestPlayer {
  kp: Keypair;
  wallet: PublicKey;
  ata: PublicKey;
}

export class World {
  svm = new LiteSVM();
  conn = new LiteConnection(this.svm);
  programId = builtProgramId();
  admin = Keypair.generate();
  operatorKp = Keypair.generate();
  mintKp = Keypair.generate();
  mint = this.mintKp.publicKey;
  treasuryWallet!: PublicKey;
  adminAta!: PublicKey;
  op!: Operator;
  /** Everything created through the helpers, for the full ledger check. */
  wallets: PublicKey[] = [];
  pools: PublicKey[] = [];
  duels: string[] = [];
  /** Tokens a test sent straight to the vault, outside the ledger. */
  surplus = 0n;

  constructor() {
    setProgramId(this.programId);
    this.svm.addProgramFromFile(this.programId, SO_PATH);
    this.setTime(T0);
    this.svm.airdrop(this.admin.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    this.svm.airdrop(this.operatorKp.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
    this.op = new Operator(this.conn, this.operatorKp, { programId: this.programId });
  }

  static async create(opts: { init?: boolean } = {}): Promise<World> {
    const w = new World();
    await w.send(
      [
        SystemProgram.createAccount({
          fromPubkey: w.admin.publicKey,
          newAccountPubkey: w.mint,
          lamports: Number(w.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(w.mint, 6, w.admin.publicKey, null),
      ],
      [w.admin, w.mintKp],
    );
    // Treasury wallet: a token account of a separate owner. Admin ATA: the faucet for tests.
    const treasuryOwner = Keypair.generate().publicKey;
    w.treasuryWallet = getAssociatedTokenAddressSync(w.mint, treasuryOwner);
    w.adminAta = getAssociatedTokenAddressSync(w.mint, w.admin.publicKey);
    await w.send(
      [
        createAssociatedTokenAccountIdempotentInstruction(w.admin.publicKey, w.treasuryWallet, treasuryOwner, w.mint),
        createAssociatedTokenAccountIdempotentInstruction(w.admin.publicKey, w.adminAta, w.admin.publicKey, w.mint),
      ],
      [w.admin],
    );
    if (opts.init !== false) await w.initialize();
    return w;
  }

  initializeIx(over: Partial<Parameters<typeof buildInitializeIx>[0]> = {}): TransactionInstruction {
    return buildInitializeIx(
      {
        admin: this.admin.publicKey,
        operator: this.operatorKp.publicKey,
        mint: this.mint,
        treasuryWallet: this.treasuryWallet,
        feeBps: DEFAULT_FEE_BPS,
        burnBps: DEFAULT_BURN_BPS,
        vestSeconds: VEST,
        unit: DEFAULT_UNIT,
        ...over,
      },
      this.programId,
    );
  }

  async initialize(): Promise<void> {
    await this.send([this.initializeIx()], [this.admin]);
  }

  /** Sends a transaction; a failure is thrown as PodiumProgramError (code = program error name). */
  async send(ixs: TransactionInstruction[], signers: Signer[], feePayer?: PublicKey): Promise<string[]> {
    const tx = new Transaction();
    tx.feePayer = feePayer ?? signers[0]!.publicKey;
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.add(...ixs);
    tx.sign(...signers);
    try {
      await this.conn.sendRawTransaction(tx.serialize());
    } catch (e) {
      throw toProgramError(e, (e as { logs?: string[] }).logs ?? []);
    }
    return this.conn.lastLogs;
  }

  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }
  setTime(t: bigint): void {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, t));
  }
  warp(seconds: bigint): void {
    this.setTime(this.now() + seconds);
  }

  async mintTo(ata: PublicKey, amount: bigint): Promise<void> {
    await this.send([createMintToInstruction(this.mint, ata, this.admin.publicKey, amount)], [this.admin]);
  }

  /** A funded wallet with a token account; registered and with `deposit` chips deposited. */
  async player(opts: { tokens?: number; deposit?: number; register?: boolean } = {}): Promise<TestPlayer> {
    const kp = Keypair.generate();
    this.svm.airdrop(kp.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const ata = getAssociatedTokenAddressSync(this.mint, kp.publicKey);
    const tokens = opts.tokens ?? opts.deposit ?? 0;
    await this.send(
      [
        createAssociatedTokenAccountIdempotentInstruction(this.admin.publicKey, ata, kp.publicKey, this.mint),
        createMintToInstruction(this.mint, ata, this.admin.publicKey, chips(tokens)),
      ],
      [this.admin],
    );
    const p = { kp, wallet: kp.publicKey, ata };
    if (opts.register !== false) this.wallets.push(kp.publicKey);
    if (opts.register !== false) await this.send([buildRegisterPlayerIx(kp.publicKey, kp.publicKey, this.programId)], [kp]);
    if (opts.deposit) await this.deposit(p, chips(opts.deposit));
    return p;
  }

  async deposit(p: TestPlayer, amount: bigint): Promise<void> {
    await this.send([buildDepositIx(p.wallet, p.ata, amount, this.programId)], [p.kp]);
  }

  /** Next operator sequence number. */
  async next(): Promise<bigint> {
    return (await this.op.opSeq()) + 1n;
  }

  config(): ConfigAccount {
    return decodeConfig(this.svm.getAccount(configPda(this.programId))!.data);
  }
  playerAcc(wallet: PublicKey): PlayerAccount {
    return decodePlayer(this.svm.getAccount(playerPda(wallet, this.programId))!.data);
  }
  pool(address: PublicKey): PoolAccount {
    return decodePool(this.svm.getAccount(address)!.data);
  }
  duel(id: string | Uint8Array): DuelAccount {
    return decodeDuel(this.svm.getAccount(duelPda(id, this.programId))!.data);
  }
  tokenBalance(tokenAccount: PublicKey): bigint {
    const a = this.svm.getAccount(tokenAccount);
    return a ? AccountLayout.decode(Buffer.from(a.data)).amount : 0n;
  }
  vaultBalance(): bigint {
    return this.tokenBalance(vaultPda(this.programId));
  }
  supply(): bigint {
    return MintLayout.decode(Buffer.from(this.svm.getAccount(this.mint)!.data)).supply;
  }

  /** The vault invariant. Tests never send tokens straight to the vault, so it holds with equality. */
  checkInvariant(): void {
    const c = this.config();
    const owed = liabilities(c);
    const held = this.vaultBalance();
    if (held < owed) throw new Error(`vault invariant broken: holds ${held}, owes ${owed}`);
    if (held !== owed + this.surplus) throw new Error(`vault holds ${held} but the ledger accounts for ${owed}`);
    // The totals in the config equal the sum of the accounts they summarise.
    let players = 0n;
    for (const k of this.wallets) {
      const p = this.playerAcc(k);
      players += p.available + p.locked;
    }
    if (players !== c.totalPlayerBalance) throw new Error(`players hold ${players}, config says ${c.totalPlayerBalance}`);
    let escrow = 0n;
    for (const a of this.pools) {
      const p = this.pool(a);
      if (!p.closed) escrow += p.total;
    }
    for (const id of this.duels) {
      const d = this.duel(id);
      if (d.state === 0) escrow += d.stake;
      if (d.state === 1) escrow += 2n * d.stake;
    }
    if (escrow !== c.totalEscrow) throw new Error(`pools and duels hold ${escrow}, config says ${c.totalEscrow}`);
  }

  /** Creates a weekly pool that ends in a week. Returns its address. */
  async createPool(over: Partial<{ kind: number; game: string; entry: bigint; splitBps: number[]; winners: number; periodStart: bigint; periodEnd: bigint }> = {}): Promise<PublicKey> {
    const kind = over.kind ?? 0;
    const game = over.game ?? 'blaster';
    const periodStart = over.periodStart ?? this.now();
    const address = poolPda(kind, game, periodStart, this.programId);
    await this.op.createPool(await this.next(), {
      kind,
      game,
      periodStart,
      periodEnd: over.periodEnd ?? periodStart + WEEK,
      entry: over.entry ?? chips(100),
      splitBps: over.splitBps ?? [5000, 3000, 2000],
      winners: over.winners ?? 3,
    });
    this.pools.push(address);
    return address;
  }

  async openDuel(id: string, creator: TestPlayer, stakeChips: number): Promise<void> {
    await this.op.duelOpen(await this.next(), { id, creator: creator.wallet, stake: chips(stakeChips), expiresAt: this.now() + 24n * 3600n });
    this.duels.push(id);
  }
}

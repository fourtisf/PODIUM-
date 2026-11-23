// Server side: the operator key submits the game server's ledger movements, one sequence number
// each, and co-signs player withdrawals. Do not import this module into a browser bundle.
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { fetchConfig, fetchDuel, fetchPlayer, type AccountReader, type ConfigAccount } from './accounts';
import { assertRpcUrl, MAINNET_GENESIS_HASH, MAINNET_LOCKED_MESSAGE } from './cluster';
import { bytesEqual } from './codec';
import { PROGRAM_ID } from './constants';
import { PodiumProgramError, toProgramError } from './errors';
import {
  buildClosePoolIx,
  buildCreatePoolIx,
  buildCreditRewardIx,
  buildDuelJoinIx,
  buildDuelOpenIx,
  buildDuelRefundIx,
  buildDuelSettleIx,
  buildEnterPoolIx,
  buildRegisterPlayerIx,
  buildSetFrozenIx,
  buildSpendIx,
  buildWithdrawIx,
  type CreatePoolArgs,
} from './instructions';
import { toBig, type U64 } from './units';

/** The part of web3.js `Connection` the operator uses. A real `Connection` satisfies it. */
export interface ChainConnection extends AccountReader {
  getLatestBlockhash(commitment?: any): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(raw: Buffer | Uint8Array | number[], options?: any): Promise<string>;
  confirmTransaction(
    strategy: { signature: string; blockhash: string; lastValidBlockHeight: number },
    commitment?: any,
  ): Promise<{ value: { err: unknown } }>;
  getGenesisHash?(): Promise<string>;
  rpcEndpoint?: string;
}

export interface OperatorOptions {
  programId?: PublicKey;
  /** Commitment used to read op_seq and to confirm. Default 'confirmed'. */
  commitment?: 'confirmed' | 'finalized';
}

export interface OpResult {
  seq: bigint;
  /** false: the chain was already at or past `seq`, nothing was sent (a retry of a done op). */
  applied: boolean;
  signature: string | null;
}

/** `seq` is more than one ahead of the chain: an earlier operation has not been applied yet. */
export class SequenceGapError extends Error {
  constructor(
    readonly seq: bigint,
    readonly onChain: bigint,
  ) {
    super(`Podium: operation seq ${seq} is ahead of the chain (op_seq ${onChain}); apply seq ${onChain + 1n} first`);
    this.name = 'SequenceGapError';
  }
}

export class WithdrawCheckError extends Error {
  constructor(reason: string) {
    super(`Podium: refusing to co-sign withdrawal: ${reason}`);
    this.name = 'WithdrawCheckError';
  }
}

export interface ExpectedWithdraw {
  wallet: PublicKey;
  /** Base units. */
  amount: U64;
  /** Default: the wallet's associated token account. */
  destination?: PublicKey;
}

export type PoolRef = PublicKey;

/**
 * Sequence numbers. The server gives every ledger movement the next number (op_seq + 1) in its
 * own database, in the same transaction that records the movement, then calls the matching
 * method here with that number. Calling again with the same number after a crash or timeout is
 * safe: if the chain is already at or past it, the call returns `{ applied: false }`.
 *
 * That check cannot tell WHICH operation used the number, so numbers must come from one
 * allocator (one database sequence), never from two processes guessing independently.
 *
 * A PodiumProgramError means the program rejected the operation and the number was NOT used:
 * the server must mark that movement failed and give the number to the next one.
 */
export class Operator {
  readonly programId: PublicKey;
  private readonly commitment: 'confirmed' | 'finalized';
  private cachedConfig: ConfigAccount | null = null;
  private checked = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly connection: ChainConnection,
    private readonly keypair: Keypair,
    opts: OperatorOptions = {},
  ) {
    this.programId = opts.programId ?? PROGRAM_ID;
    this.commitment = opts.commitment ?? 'confirmed';
    if (typeof connection.rpcEndpoint === 'string') assertRpcUrl(connection.rpcEndpoint);
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  /** Refuses mainnet by genesis hash, whatever the RPC URL looks like. Runs once. */
  private async guard(): Promise<void> {
    if (this.checked) return;
    if (typeof this.connection.getGenesisHash === 'function') {
      if ((await this.connection.getGenesisHash()) === MAINNET_GENESIS_HASH) throw new Error(MAINNET_LOCKED_MESSAGE);
    }
    this.checked = true;
  }

  /** The config account. Cached fields (mint, vault) never change; pass `refresh` for balances. */
  async config(refresh = false): Promise<ConfigAccount> {
    await this.guard();
    if (!this.cachedConfig || refresh) this.cachedConfig = await fetchConfig(this.connection, this.programId);
    return this.cachedConfig;
  }

  /** Sequence number of the last operator instruction applied on-chain. */
  async opSeq(): Promise<bigint> {
    return (await this.config(true)).opSeq;
  }

  // ---------------------------------------------------------------- sending

  private async send(ixs: TransactionInstruction[]): Promise<string> {
    await this.guard();
    const bh = await this.connection.getLatestBlockhash(this.commitment);
    const tx = new Transaction();
    tx.feePayer = this.keypair.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.add(...ixs);
    tx.sign(this.keypair);
    return this.sendSigned(tx, bh);
  }

  private async sendSigned(tx: Transaction, bh: { blockhash: string; lastValidBlockHeight: number }): Promise<string> {
    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(tx.serialize(), { preflightCommitment: this.commitment });
    } catch (e) {
      let logs: string[] = [];
      try {
        const l = (e as { logs?: unknown }).logs;
        if (Array.isArray(l)) logs = l as string[];
      } catch {
        /* logs unavailable */
      }
      throw toProgramError(e, logs);
    }
    const res = await this.connection.confirmTransaction({ signature, ...bh }, this.commitment);
    if (res.value.err) throw toProgramError(res.value.err);
    return signature;
  }

  /** Serializes calls so two operations never race for the same sequence number in-process. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private sequenced(seqIn: U64, build: (seq: bigint) => Promise<TransactionInstruction> | TransactionInstruction): Promise<OpResult> {
    const seq = toBig(seqIn);
    return this.exclusive(async () => {
      const onChain = await this.opSeq();
      if (onChain >= seq) return { seq, applied: false, signature: null };
      if (seq !== onChain + 1n) throw new SequenceGapError(seq, onChain);
      const ix = await build(seq);
      try {
        return { seq, applied: true, signature: await this.send([ix]) };
      } catch (e) {
        // A definite rejection by the program for any other reason: nothing applied, seq unused.
        if (e instanceof PodiumProgramError && e.code && e.code !== 'BadSequence') throw e;
        // BadSequence, a timeout or a network error: the number may have been used meanwhile.
        const after = await this.opSeq().catch(() => null);
        if (after !== null && after >= seq) return { seq, applied: false, signature: null };
        throw e;
      }
    });
  }

  // ---------------------------------------------------------------- operator instructions

  createPool(seq: U64, args: Omit<CreatePoolArgs, 'seq'>): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildCreatePoolIx(this.publicKey, { ...args, seq: s }, this.programId));
  }

  /** `pool` is the pool's address (`poolPda(kind, game, periodStart)`). */
  enterPool(seq: U64, pool: PoolRef, wallet: PublicKey): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildEnterPoolIx(this.publicKey, s, pool, wallet, this.programId));
  }

  /** `winners` in place order; each gets its `payout` (base units). */
  closePool(seq: U64, pool: PoolRef, winners: readonly { wallet: PublicKey; payout: U64 }[]): Promise<OpResult> {
    return this.sequenced(seq, (s) =>
      buildClosePoolIx(this.publicKey, s, pool, winners.map((x) => x.wallet), winners.map((x) => x.payout), this.programId),
    );
  }

  duelOpen(seq: U64, a: { id: string | Uint8Array; creator: PublicKey; stake: U64; expiresAt: bigint | number }): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildDuelOpenIx(this.publicKey, s, a.id, a.creator, a.stake, a.expiresAt, this.programId));
  }

  duelJoin(seq: U64, id: string | Uint8Array, joiner: PublicKey): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildDuelJoinIx(this.publicKey, s, id, joiner, this.programId));
  }

  /** `winner` null = forfeit: the whole pot goes to the treasury and `payout` must be 0. */
  duelSettle(seq: U64, id: string | Uint8Array, winner: PublicKey | null, payout: U64): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildDuelSettleIx(this.publicKey, s, id, winner, payout, this.programId));
  }

  /** Open duels only. `creator` is read from the duel account when not given. */
  duelRefund(seq: U64, id: string | Uint8Array, creator?: PublicKey): Promise<OpResult> {
    return this.sequenced(seq, async (s) => {
      let who = creator;
      if (!who) {
        const duel = await fetchDuel(this.connection, id, this.programId);
        if (!duel) throw new Error('Podium: duel not found');
        who = duel.creator;
      }
      return buildDuelRefundIx(this.publicKey, s, id, who, this.programId);
    });
  }

  /** Shop purchase: `burnAmount` of `amount` is burned on-chain, the rest goes to the treasury. */
  spend(seq: U64, wallet: PublicKey, amount: U64, burnAmount: U64): Promise<OpResult> {
    return this.sequenced(seq, async (s) =>
      buildSpendIx(this.publicKey, s, wallet, (await this.config()).mint, amount, burnAmount, this.programId),
    );
  }

  creditReward(seq: U64, wallet: PublicKey, amount: U64): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildCreditRewardIx(this.publicKey, s, wallet, amount, this.programId));
  }

  setFrozen(seq: U64, wallet: PublicKey, frozen: boolean): Promise<OpResult> {
    return this.sequenced(seq, (s) => buildSetFrozenIx(this.publicKey, s, wallet, frozen, this.programId));
  }

  // ---------------------------------------------------------------- not sequenced

  /** Creates the wallet's Player account, paid by the operator. Returns null if it exists. */
  registerPlayer(wallet: PublicKey): Promise<string | null> {
    return this.exclusive(async () => {
      if (await fetchPlayer(this.connection, wallet, this.programId)) return null;
      try {
        return await this.send([buildRegisterPlayerIx(this.publicKey, wallet, this.programId)]);
      } catch (e) {
        if (await fetchPlayer(this.connection, wallet, this.programId).catch(() => null)) return null;
        throw e;
      }
    });
  }

  /**
   * Checks a withdraw transaction the player has signed and adds the operator's signature.
   * The caller must already have checked its own ledger and reserved the amount.
   *
   * The transaction must be a legacy transaction with exactly one instruction: this program's
   * `withdraw` for `expected.wallet`, `expected.amount` and the expected destination; the fee
   * payer must be the player; the only signers may be the player and the operator; and the
   * player's signature must already be valid. Anything else throws WithdrawCheckError.
   */
  async coSignWithdraw(serializedTxFromPlayer: Uint8Array | string, expected: ExpectedWithdraw): Promise<Transaction> {
    const raw = typeof serializedTxFromPlayer === 'string' ? Buffer.from(serializedTxFromPlayer, 'base64') : Buffer.from(serializedTxFromPlayer);
    const cfg = await this.config();
    if (!cfg.operator.equals(this.publicKey)) throw new WithdrawCheckError('this key is not the on-chain operator');

    // Legacy only: byte 0 is the signature count, and a versioned message starts with a high bit.
    const sigCount = raw[0];
    if (sigCount === undefined || sigCount !== 2) throw new WithdrawCheckError('expected exactly two signature slots');
    const msgStart = 1 + 64 * sigCount;
    if (raw.length <= msgStart || (raw[msgStart]! & 0x80) !== 0) throw new WithdrawCheckError('only legacy transactions are accepted');

    let tx: Transaction;
    try {
      tx = Transaction.from(raw);
    } catch {
      throw new WithdrawCheckError('transaction does not parse');
    }
    if (tx.instructions.length !== 1) throw new WithdrawCheckError('transaction must contain exactly one instruction');
    const got = tx.instructions[0]!;
    const destination = expected.destination ?? getAssociatedTokenAddressSync(cfg.mint, expected.wallet, true);
    const want = buildWithdrawIx(expected.wallet, this.publicKey, destination, expected.amount, this.programId);

    if (!got.programId.equals(this.programId)) throw new WithdrawCheckError('instruction is not for the Podium program');
    if (!bytesEqual(got.data, want.data)) throw new WithdrawCheckError('instruction is not withdraw for the expected amount');
    if (got.keys.length !== want.keys.length) throw new WithdrawCheckError('unexpected accounts');
    for (let i = 0; i < want.keys.length; i++) {
      if (!got.keys[i]!.pubkey.equals(want.keys[i]!.pubkey)) throw new WithdrawCheckError(`account ${i} is not the expected one`);
    }
    if (!tx.feePayer || !tx.feePayer.equals(expected.wallet)) throw new WithdrawCheckError('the player must be the fee payer');
    const signers = tx.signatures.map((s) => s.publicKey);
    if (signers.length !== 2 || !signers.some((k) => k.equals(expected.wallet)) || !signers.some((k) => k.equals(this.publicKey))) {
      throw new WithdrawCheckError('signers must be exactly the player and the operator');
    }
    const playerSig = tx.signatures.find((s) => s.publicKey.equals(expected.wallet));
    if (!playerSig?.signature) throw new WithdrawCheckError('the player has not signed');

    tx.partialSign(this.keypair);
    if (!tx.verifySignatures(true)) throw new WithdrawCheckError("the player's signature is not valid");
    return tx;
  }

  /** Co-signs, sends and confirms a player's withdrawal. Returns the transaction signature. */
  async submitWithdraw(serializedTxFromPlayer: Uint8Array | string, expected: ExpectedWithdraw): Promise<string> {
    const tx = await this.coSignWithdraw(serializedTxFromPlayer, expected);
    // The player's blockhash is reused; confirmation falls back to a fresh height window.
    const bh = await this.connection.getLatestBlockhash(this.commitment);
    return this.sendSigned(tx, { blockhash: tx.recentBlockhash!, lastValidBlockHeight: bh.lastValidBlockHeight });
  }
}

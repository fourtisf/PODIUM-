// Browser-safe. One builder per program instruction. Account order matches the program exactly.
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { MAX_WINNERS, PROGRAM_ID } from './constants';
import { discriminator, Writer } from './codec';
import { configPda, duelIdBytes, duelPda, gameBytes, playerPda, poolPda, vaultPda } from './pda';
import type { U64 } from './units';

type I64 = bigint | number;

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

function ix(name: string, keys: AccountMeta[], args: Writer, programId: PublicKey): TransactionInstruction {
  const data = new Writer().bytes(discriminator('global', name)).bytes(args.finish()).finish();
  return new TransactionInstruction({ programId, keys, data: Buffer.from(data) });
}

// ---------------------------------------------------------------- admin

export interface InitializeArgs {
  admin: PublicKey;
  operator: PublicKey;
  mint: PublicKey;
  /** Token account (of `mint`) that treasury withdrawals are paid to. Fixed for good. */
  treasuryWallet: PublicKey;
  feeBps: number;
  burnBps: number;
  vestSeconds: I64;
  /** Base units per whole chip. */
  unit: U64;
}

export function buildInitializeIx(a: InitializeArgs, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'initialize',
    [
      w(a.admin, true),
      w(configPda(programId)),
      r(a.mint),
      w(vaultPda(programId)),
      r(a.treasuryWallet),
      r(TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    new Writer().pubkey(a.operator).u16(a.feeBps).u16(a.burnBps).i64(a.vestSeconds).u64(a.unit),
    programId,
  );
}

const adminKeys = (admin: PublicKey, programId: PublicKey): AccountMeta[] => [r(admin, true), w(configPda(programId))];

export function buildSetOperatorIx(admin: PublicKey, operator: PublicKey, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix('set_operator', adminKeys(admin, programId), new Writer().pubkey(operator), programId);
}

export function buildSetPausedIx(admin: PublicKey, paused: boolean, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix('set_paused', adminKeys(admin, programId), new Writer().bool(paused), programId);
}

export function buildSetVestSecondsIx(admin: PublicKey, vestSeconds: I64, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix('set_vest_seconds', adminKeys(admin, programId), new Writer().i64(vestSeconds), programId);
}

/** `treasuryWallet` must be the one recorded in the config. */
export function buildTreasuryWithdrawIx(
  admin: PublicKey,
  treasuryWallet: PublicKey,
  amount: U64,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  return ix(
    'treasury_withdraw',
    [r(admin, true), w(configPda(programId)), w(vaultPda(programId)), w(treasuryWallet), r(TOKEN_PROGRAM_ID)],
    new Writer().u64(amount),
    programId,
  );
}

export function buildTreasuryToRewardsIx(admin: PublicKey, amount: U64, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix('treasury_to_rewards', adminKeys(admin, programId), new Writer().u64(amount), programId);
}

// ---------------------------------------------------------------- anyone

/** `source` is a token account the funder controls. */
export function buildFundRewardsIx(funder: PublicKey, source: PublicKey, amount: U64, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'fund_rewards',
    [r(funder, true), w(configPda(programId)), w(source), w(vaultPda(programId)), r(TOKEN_PROGRAM_ID)],
    new Writer().u64(amount),
    programId,
  );
}

/** Creates the Player account of `wallet`. Any signer may pay, so the server can register a player. */
export function buildRegisterPlayerIx(payer: PublicKey, wallet: PublicKey, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'register_player',
    [w(payer, true), w(playerPda(wallet, programId)), r(SystemProgram.programId)],
    new Writer().pubkey(wallet),
    programId,
  );
}

// ---------------------------------------------------------------- player

/** `source` must be a token account owned by `wallet`. */
export function buildDepositIx(wallet: PublicKey, source: PublicKey, amount: U64, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'deposit',
    [r(wallet, true), w(configPda(programId)), w(playerPda(wallet, programId)), w(source), w(vaultPda(programId)), r(TOKEN_PROGRAM_ID)],
    new Writer().u64(amount),
    programId,
  );
}

/** Signed by the player AND the operator. `destination` must be a token account owned by `wallet`. */
export function buildWithdrawIx(
  wallet: PublicKey,
  operator: PublicKey,
  destination: PublicKey,
  amount: U64,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  return ix(
    'withdraw',
    [
      r(wallet, true),
      r(operator, true),
      w(configPda(programId)),
      w(playerPda(wallet, programId)),
      w(vaultPda(programId)),
      w(destination),
      r(TOKEN_PROGRAM_ID),
    ],
    new Writer().u64(amount),
    programId,
  );
}

// ---------------------------------------------------------------- operator

export interface CreatePoolArgs {
  seq: U64;
  /** 0 weekly, 1 cup. */
  kind: number;
  game: string | Uint8Array;
  /** Unix seconds. */
  periodStart: I64;
  periodEnd: I64;
  /** Entry in base units. */
  entry: U64;
  /** Shares of the after-fee pot per place, in bps; at most 5, summing to at most 10000. */
  splitBps: readonly number[];
  winners: number;
}

/** Turns a split such as [0.5, 0.3, 0.2] into the five bps values stored on-chain. */
export function splitToBps(split: readonly number[]): number[] {
  if (split.length > MAX_WINNERS) throw new RangeError(`at most ${MAX_WINNERS} places`);
  const out = split.map((s) => Math.round(s * 10_000));
  while (out.length < MAX_WINNERS) out.push(0);
  return out;
}

export function buildCreatePoolIx(operator: PublicKey, a: CreatePoolArgs, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  if (a.splitBps.length > MAX_WINNERS) throw new RangeError(`at most ${MAX_WINNERS} places`);
  const split = [...a.splitBps];
  while (split.length < MAX_WINNERS) split.push(0);
  const args = new Writer().u64(a.seq).u8(a.kind).bytes(gameBytes(a.game)).i64(a.periodStart).i64(a.periodEnd).u64(a.entry);
  for (const s of split) args.u16(s);
  args.u8(a.winners);
  return ix(
    'create_pool',
    [w(operator, true), w(configPda(programId)), w(poolPda(a.kind, a.game, BigInt(a.periodStart), programId)), r(SystemProgram.programId)],
    args,
    programId,
  );
}

export function buildEnterPoolIx(operator: PublicKey, seq: U64, pool: PublicKey, wallet: PublicKey, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'enter_pool',
    [r(operator, true), w(configPda(programId)), w(pool), w(playerPda(wallet, programId))],
    new Writer().u64(seq),
    programId,
  );
}

/** `winners[i]` (a wallet) receives `payouts[i]`, in place order. */
export function buildClosePoolIx(
  operator: PublicKey,
  seq: U64,
  pool: PublicKey,
  winners: readonly PublicKey[],
  payouts: readonly U64[],
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  if (winners.length !== payouts.length) throw new RangeError('one payout per winner');
  if (winners.length > MAX_WINNERS) throw new RangeError(`at most ${MAX_WINNERS} winners`);
  const args = new Writer().u64(seq).u32(payouts.length);
  for (const p of payouts) args.u64(p);
  return ix(
    'close_pool',
    [r(operator, true), w(configPda(programId)), w(pool), ...winners.map((k) => w(playerPda(k, programId)))],
    args,
    programId,
  );
}

export function buildDuelOpenIx(
  operator: PublicKey,
  seq: U64,
  id: string | Uint8Array,
  creator: PublicKey,
  stake: U64,
  expiresAt: I64,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  return ix(
    'duel_open',
    [w(operator, true), w(configPda(programId)), w(duelPda(id, programId)), w(playerPda(creator, programId)), r(SystemProgram.programId)],
    new Writer().u64(seq).bytes(duelIdBytes(id)).u64(stake).i64(expiresAt),
    programId,
  );
}

export function buildDuelJoinIx(operator: PublicKey, seq: U64, id: string | Uint8Array, joiner: PublicKey, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'duel_join',
    [r(operator, true), w(configPda(programId)), w(duelPda(id, programId)), w(playerPda(joiner, programId))],
    new Writer().u64(seq),
    programId,
  );
}

/**
 * `winner` (a wallet) must be the duel's creator or joiner and the duel must be matched.
 * With `winner` null the whole pot goes to the treasury and `payout` must be 0 (forfeit).
 */
export function buildDuelSettleIx(
  operator: PublicKey,
  seq: U64,
  id: string | Uint8Array,
  winner: PublicKey | null,
  payout: U64,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  return ix(
    'duel_settle',
    // Anchor reads the program id in an optional account's slot as "not given".
    [r(operator, true), w(configPda(programId)), w(duelPda(id, programId)), winner ? w(playerPda(winner, programId)) : r(programId)],
    new Writer().u64(seq).u64(payout),
    programId,
  );
}

/** `creator` is the wallet that opened the duel. */
export function buildDuelRefundIx(operator: PublicKey, seq: U64, id: string | Uint8Array, creator: PublicKey, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'duel_refund',
    [r(operator, true), w(configPda(programId)), w(duelPda(id, programId)), w(playerPda(creator, programId))],
    new Writer().u64(seq),
    programId,
  );
}

export function buildSpendIx(
  operator: PublicKey,
  seq: U64,
  wallet: PublicKey,
  mint: PublicKey,
  amount: U64,
  burnAmount: U64,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  return ix(
    'spend',
    [r(operator, true), w(configPda(programId)), w(playerPda(wallet, programId)), w(mint), w(vaultPda(programId)), r(TOKEN_PROGRAM_ID)],
    new Writer().u64(seq).u64(amount).u64(burnAmount),
    programId,
  );
}

export function buildCreditRewardIx(operator: PublicKey, seq: U64, wallet: PublicKey, amount: U64, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'credit_reward',
    [r(operator, true), w(configPda(programId)), w(playerPda(wallet, programId))],
    new Writer().u64(seq).u64(amount),
    programId,
  );
}

export function buildSetFrozenIx(operator: PublicKey, seq: U64, wallet: PublicKey, frozen: boolean, programId: PublicKey = PROGRAM_ID): TransactionInstruction {
  return ix(
    'set_frozen',
    [r(operator, true), w(configPda(programId)), w(playerPda(wallet, programId))],
    new Writer().u64(seq).bool(frozen),
    programId,
  );
}

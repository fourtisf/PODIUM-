// Browser-safe. Decoders and fetchers for the program's accounts. All amounts are bigint base units.
import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';
import { bytesEqual, discriminator, Reader } from './codec';
import { configPda, duelPda, gameFromBytes, playerPda, poolPda } from './pda';
import type { U64 } from './units';

export interface ConfigAccount {
  admin: PublicKey;
  operator: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  treasuryWallet: PublicKey;
  feeBps: number;
  burnBps: number;
  vestSeconds: bigint;
  unit: bigint;
  opSeq: bigint;
  treasuryBalance: bigint;
  rewardsBalance: bigint;
  totalPlayerBalance: bigint;
  totalEscrow: bigint;
  totalBurned: bigint;
  paused: boolean;
  bump: number;
}

export interface PlayerAccount {
  wallet: PublicKey;
  available: bigint;
  locked: bigint;
  /** Unix seconds. */
  unlockAt: bigint;
  frozen: boolean;
  bump: number;
}

export interface PoolAccount {
  kind: number;
  /** Game key with the zero padding removed. */
  game: string;
  gameBytes: Uint8Array;
  periodStart: bigint;
  periodEnd: bigint;
  entry: bigint;
  feeBps: number;
  splitBps: number[];
  winners: number;
  total: bigint;
  lockedPart: bigint;
  entries: number;
  closed: boolean;
  bump: number;
}

export interface DuelAccount {
  id: Uint8Array;
  creator: PublicKey;
  /** null until matched. */
  joiner: PublicKey | null;
  stake: bigint;
  feeBps: number;
  state: number;
  lockedPart: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  bump: number;
}

function body(data: Uint8Array, name: string): Reader {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), discriminator('account', name))) {
    throw new Error(`not a Podium ${name} account`);
  }
  return new Reader(data.subarray(8));
}

export function decodeConfig(data: Uint8Array): ConfigAccount {
  const r = body(data, 'Config');
  return {
    admin: r.pubkey(),
    operator: r.pubkey(),
    mint: r.pubkey(),
    vault: r.pubkey(),
    treasuryWallet: r.pubkey(),
    feeBps: r.u16(),
    burnBps: r.u16(),
    vestSeconds: r.i64(),
    unit: r.u64(),
    opSeq: r.u64(),
    treasuryBalance: r.u64(),
    rewardsBalance: r.u64(),
    totalPlayerBalance: r.u64(),
    totalEscrow: r.u64(),
    totalBurned: r.u64(),
    paused: r.bool(),
    bump: r.u8(),
  };
}

export function decodePlayer(data: Uint8Array): PlayerAccount {
  const r = body(data, 'Player');
  return { wallet: r.pubkey(), available: r.u64(), locked: r.u64(), unlockAt: r.i64(), frozen: r.bool(), bump: r.u8() };
}

export function decodePool(data: Uint8Array): PoolAccount {
  const r = body(data, 'Pool');
  const kind = r.u8();
  const gb = r.bytes(16);
  return {
    kind,
    game: gameFromBytes(gb),
    gameBytes: gb,
    periodStart: r.i64(),
    periodEnd: r.i64(),
    entry: r.u64(),
    feeBps: r.u16(),
    splitBps: [r.u16(), r.u16(), r.u16(), r.u16(), r.u16()],
    winners: r.u8(),
    total: r.u64(),
    lockedPart: r.u64(),
    entries: r.u32(),
    closed: r.bool(),
    bump: r.u8(),
  };
}

export function decodeDuel(data: Uint8Array): DuelAccount {
  const r = body(data, 'Duel');
  const id = r.bytes(16);
  const creator = r.pubkey();
  const joiner = r.pubkey();
  return {
    id,
    creator,
    joiner: joiner.equals(PublicKey.default) ? null : joiner,
    stake: r.u64(),
    feeBps: r.u16(),
    state: r.u8(),
    lockedPart: r.u64(),
    createdAt: r.i64(),
    expiresAt: r.i64(),
    bump: r.u8(),
  };
}

/** The part of web3.js `Connection` the fetchers need. */
export interface AccountReader {
  getAccountInfo(address: PublicKey, commitment?: any): Promise<{ data: Uint8Array; owner: PublicKey } | null>;
}

async function load(conn: AccountReader, address: PublicKey, programId: PublicKey): Promise<Uint8Array | null> {
  const info = await conn.getAccountInfo(address);
  if (!info) return null;
  if (!info.owner.equals(programId)) throw new Error(`account ${address.toBase58()} is not owned by the Podium program`);
  return info.data;
}

/** Throws if the program has not been initialized. */
export async function fetchConfig(conn: AccountReader, programId: PublicKey = PROGRAM_ID): Promise<ConfigAccount> {
  const data = await load(conn, configPda(programId), programId);
  if (!data) throw new Error('Podium config account not found: the program is not initialized on this cluster');
  return decodeConfig(data);
}

/** null when the wallet has no Player account yet. */
export async function fetchPlayer(conn: AccountReader, wallet: PublicKey, programId: PublicKey = PROGRAM_ID): Promise<PlayerAccount | null> {
  const data = await load(conn, playerPda(wallet, programId), programId);
  return data ? decodePlayer(data) : null;
}

export async function fetchPool(
  conn: AccountReader,
  kind: number,
  game: string | Uint8Array,
  periodStart: U64,
  programId: PublicKey = PROGRAM_ID,
): Promise<PoolAccount | null> {
  const data = await load(conn, poolPda(kind, game, periodStart, programId), programId);
  return data ? decodePool(data) : null;
}

export async function fetchDuel(conn: AccountReader, id: string | Uint8Array, programId: PublicKey = PROGRAM_ID): Promise<DuelAccount | null> {
  const data = await load(conn, duelPda(id, programId), programId);
  return data ? decodeDuel(data) : null;
}

/**
 * What the player could withdraw at `now` (unix seconds): available, plus locked once it has
 * matured. The program folds matured locked tokens into available the same way.
 */
export function matured(player: Pick<PlayerAccount, 'available' | 'locked' | 'unlockAt'>, now: number | bigint): bigint {
  const t = typeof now === 'bigint' ? now : BigInt(Math.floor(now));
  return player.locked > 0n && t >= player.unlockAt ? player.available + player.locked : player.available;
}

/** Tokens the vault must hold to cover the ledger. */
export function liabilities(c: Pick<ConfigAccount, 'treasuryBalance' | 'rewardsBalance' | 'totalPlayerBalance' | 'totalEscrow'>): bigint {
  return c.treasuryBalance + c.rewardsBalance + c.totalPlayerBalance + c.totalEscrow;
}

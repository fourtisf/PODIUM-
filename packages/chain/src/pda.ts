// Browser-safe. Program-derived addresses.
import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, SEEDS } from './constants';
import { toBig, type U64 } from './units';

const enc = new TextEncoder();
const seed = (s: string): Uint8Array => enc.encode(s);

/** A game key such as "blaster" as the 16 zero-padded bytes stored on-chain. */
export function gameBytes(game: string | Uint8Array): Uint8Array {
  const raw = typeof game === 'string' ? enc.encode(game) : game;
  if (raw.length === 0 || raw.length > 16) throw new RangeError('game key must be 1 to 16 bytes');
  const out = new Uint8Array(16);
  out.set(raw);
  return out;
}

export function gameFromBytes(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** A duel id as 16 bytes: a UUID string (with or without dashes), 32 hex chars, or raw bytes. */
export function duelIdBytes(id: string | Uint8Array): Uint8Array {
  if (typeof id !== 'string') {
    if (id.length !== 16) throw new RangeError('duel id must be 16 bytes');
    return Uint8Array.from(id);
  }
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new RangeError('duel id must be a UUID or 32 hex characters');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function i64le(v: U64 | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, typeof v === 'bigint' ? v : BigInt(v), true);
  return out;
}

export function configPda(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.config)], programId)[0];
}

/** The program's token vault. Its token authority is the config PDA. */
export function vaultPda(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.vault)], programId)[0];
}

export function playerPda(wallet: PublicKey, programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.player), wallet.toBytes()], programId)[0];
}

/** `periodStart` is unix seconds. */
export function poolPda(kind: number, game: string | Uint8Array, periodStart: U64, programId: PublicKey = PROGRAM_ID): PublicKey {
  if (kind !== 0 && kind !== 1) throw new RangeError('pool kind must be 0 (weekly) or 1 (cup)');
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.pool), Uint8Array.of(kind), gameBytes(game), i64le(toBig(periodStart))],
    programId,
  )[0];
}

export function duelPda(id: string | Uint8Array, programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.duel), duelIdBytes(id)], programId)[0];
}

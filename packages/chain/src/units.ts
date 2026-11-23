// Browser-safe. Whole chips <-> base units of the token.
import { DEFAULT_UNIT } from './constants';

export type U64 = bigint | number;

export function toBig(v: U64): bigint {
  if (typeof v === 'bigint') {
    if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new RangeError(`amount out of u64 range: ${v}`);
    return v;
  }
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`amount must be a non-negative safe integer: ${v}`);
  return BigInt(v);
}

/** Whole chips to base units. Chips are whole numbers everywhere in Podium. */
export function toBase(chips: number | bigint, unit: U64 = DEFAULT_UNIT): bigint {
  if (typeof chips === 'number' && (!Number.isSafeInteger(chips) || chips < 0)) {
    throw new RangeError(`chips must be a non-negative whole number: ${chips}`);
  }
  return toBig(chips) * toBig(unit);
}

/** Base units to whole chips, rounded down. Throws if the result does not fit a JS number. */
export function toChips(base: U64, unit: U64 = DEFAULT_UNIT): number {
  const q = toBig(base) / toBig(unit);
  if (q > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('chip amount too large');
  return Number(q);
}

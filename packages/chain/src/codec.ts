// Browser-safe. Borsh-style little-endian reader/writer and Anchor discriminators.
import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';
import { toBig, type U64 } from './units';

const enc = new TextEncoder();

/** First 8 bytes of sha256("<namespace>:<name>"), as Anchor computes them. */
export function discriminator(namespace: 'global' | 'account', name: string): Uint8Array {
  return sha256(enc.encode(`${namespace}:${name}`)).slice(0, 8);
}

export class Writer {
  private parts: Uint8Array[] = [];
  bytes(b: Uint8Array): this {
    this.parts.push(b);
    return this;
  }
  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new RangeError(`u8 out of range: ${v}`);
    return this.bytes(Uint8Array.of(v));
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u16(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError(`u16 out of range: ${v}`);
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    return this.bytes(b);
  }
  u32(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff_ffff) throw new RangeError(`u32 out of range: ${v}`);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return this.bytes(b);
  }
  u64(v: U64): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, toBig(v), true);
    return this.bytes(b);
  }
  i64(v: bigint | number): this {
    const n = typeof v === 'bigint' ? v : BigInt(v);
    if (n < -(1n << 63n) || n >= 1n << 63n) throw new RangeError(`i64 out of range: ${n}`);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, n, true);
    return this.bytes(b);
  }
  pubkey(k: PublicKey): this {
    return this.bytes(k.toBytes());
  }
  finish(): Uint8Array {
    const len = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export class Reader {
  private view: DataView;
  private o = 0;
  constructor(private data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  private take(n: number): number {
    if (this.o + n > this.data.length) throw new RangeError('account data too short');
    const at = this.o;
    this.o += n;
    return at;
  }
  bytes(n: number): Uint8Array {
    const at = this.take(n);
    return this.data.slice(at, at + n);
  }
  u8(): number {
    return this.view.getUint8(this.take(1));
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }
  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }
  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true);
  }
  i64(): bigint {
    return this.view.getBigInt64(this.take(8), true);
  }
  pubkey(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

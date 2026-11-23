// What the API needs from a Solana RPC node. A web3.js Connection is adapted by connectionRpc();
// tests pass an in-process chain (packages/chain/src/testing.ts) that offers the same calls.
import type { ChainConnection } from '@podium/chain';
import type { Connection, PublicKey } from '@solana/web3.js';

export interface TxInfo {
  /** The transaction succeeded. */
  ok: boolean;
  logs: string[];
}

export interface ChainRpc extends ChainConnection {
  getGenesisHash(): Promise<string>;
  /** The cluster's clock in unix seconds (what the program sees as "now"). */
  chainTime(): Promise<number>;
  /** Finalized block height. A blockhash whose lastValidBlockHeight is below it can never land. */
  finalizedHeight(): Promise<number>;
  /** A confirmed transaction, or null when the node does not know it (yet). */
  txInfo(signature: string): Promise<TxInfo | null>;
  /** Newest first. */
  signaturesFor(address: PublicKey, limit: number): Promise<{ signature: string; ok: boolean }[]>;
  /** 'ok' / 'failed' once confirmed, null while unknown. */
  signatureStatus(signature: string): Promise<'ok' | 'failed' | null>;
}

export function connectionRpc(c: Connection): ChainRpc {
  return {
    rpcEndpoint: c.rpcEndpoint,
    getAccountInfo: (address, commitment) => c.getAccountInfo(address, commitment),
    getLatestBlockhash: (commitment) => c.getLatestBlockhash(commitment),
    sendRawTransaction: (raw, options) => c.sendRawTransaction(raw, options),
    confirmTransaction: (strategy, commitment) => c.confirmTransaction(strategy, commitment),
    getGenesisHash: () => c.getGenesisHash(),
    async chainTime() {
      const t = await c.getBlockTime(await c.getSlot('confirmed')).catch(() => null);
      return t ?? Math.floor(Date.now() / 1000);
    },
    finalizedHeight: () => c.getBlockHeight('finalized'),
    async txInfo(signature) {
      const tx = await c.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx) return null;
      return { ok: !!tx.meta && !tx.meta.err, logs: tx.meta?.logMessages ?? [] };
    },
    async signaturesFor(address, limit) {
      return (await c.getSignaturesForAddress(address, { limit }, 'confirmed')).map((s) => ({ signature: s.signature, ok: !s.err }));
    },
    async signatureStatus(signature) {
      const v = (await c.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
      if (!v) return null;
      if (v.err) return 'failed';
      return v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized' ? 'ok' : null;
    },
  };
}

/**
 * The "Program log:" lines that `programId` itself wrote. A transaction can run several programs
 * and any of them can log any text, so a log line only counts when our program was the one
 * executing. Returns null when the node truncated the log (nothing can be trusted then).
 */
export function logsOfProgram(logs: readonly string[], programId: string): string[] | null {
  const stack: string[] = [];
  const out: string[] = [];
  for (const line of logs) {
    if (line.startsWith('Log truncated')) return null;
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith('Program log: ') && stack[stack.length - 1] === programId) out.push(line);
  }
  return out;
}

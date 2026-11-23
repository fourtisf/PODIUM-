// Browser-safe. The transactions a player signs in their wallet.
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';
import { buildDepositIx, buildRegisterPlayerIx, buildWithdrawIx } from './instructions';
import type { U64 } from './units';

export interface PlayerTxBase {
  wallet: PublicKey;
  mint: PublicKey;
  /** Base units. */
  amount: U64;
  /** From `connection.getLatestBlockhash()`. */
  recentBlockhash: string;
  programId?: PublicKey;
}

export interface DepositTxArgs extends PlayerTxBase {
  /** Token account to pay from. Default: the wallet's associated token account. */
  source?: PublicKey;
  /** Put `register_player` first, for a wallet with no Player account yet. */
  register?: boolean;
}

/** Unsigned deposit transaction; the wallet pays the fee and signs. */
export function buildDepositTx(a: DepositTxArgs): Transaction {
  const programId = a.programId ?? PROGRAM_ID;
  const source = a.source ?? getAssociatedTokenAddressSync(a.mint, a.wallet, true);
  const tx = new Transaction();
  tx.feePayer = a.wallet;
  tx.recentBlockhash = a.recentBlockhash;
  if (a.register) tx.add(buildRegisterPlayerIx(a.wallet, a.wallet, programId));
  tx.add(buildDepositIx(a.wallet, source, a.amount, programId));
  return tx;
}

export interface WithdrawTxArgs extends PlayerTxBase {
  /** The operator key from the config; it co-signs on the server. */
  operator: PublicKey;
  /** Token account to receive. Default: the wallet's associated token account (it must exist). */
  destination?: PublicKey;
}

/**
 * Unsigned withdraw transaction with exactly one instruction. The wallet pays the fee and signs
 * first (`signTransaction`, not `signAndSend`); the result is serialized with
 * `serialize({ requireAllSignatures: false })` and posted to the server, which checks its ledger,
 * co-signs with `Operator.coSignWithdraw` and sends it.
 */
export function buildWithdrawTx(a: WithdrawTxArgs): Transaction {
  const programId = a.programId ?? PROGRAM_ID;
  const destination = a.destination ?? getAssociatedTokenAddressSync(a.mint, a.wallet, true);
  const tx = new Transaction();
  tx.feePayer = a.wallet;
  tx.recentBlockhash = a.recentBlockhash;
  return tx.add(buildWithdrawIx(a.wallet, a.operator, destination, a.amount, programId));
}

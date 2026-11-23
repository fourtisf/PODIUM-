// Shared by setup-devnet.ts and localnet-smoke.ts. Node only.
import { readFileSync } from 'node:fs';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_DECIMALS } from '../src/index';

/** The test token has no on-chain metadata account; this label is written as a memo when it is created. */
export const TEST_TOKEN_NAME = 'Podium Test Chip (tCHIP) - TEST TOKEN, NO VALUE, devnet/localnet only';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function send(connection: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
}

/** A 6-decimal classic SPL mint with `authority` as mint authority and no freeze authority. */
export async function createTestMint(connection: Connection, authority: Keypair, withMemo = true): Promise<PublicKey> {
  const mint = Keypair.generate();
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, TOKEN_DECIMALS, authority.publicKey, null),
  ];
  if (withMemo) ixs.push(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(TEST_TOKEN_NAME, 'utf8') }));
  await send(connection, ixs, [authority, mint]);
  return mint.publicKey;
}

/** Creates `owner`'s associated token account if needed and mints `amount` base units into it. */
export async function mintTo(connection: Connection, mint: PublicKey, authority: Keypair, owner: PublicKey, amount: bigint): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, mint)];
  if (amount > 0n) ixs.push(createMintToInstruction(mint, ata, authority.publicKey, amount));
  await send(connection, ixs, [authority]);
  return ata;
}

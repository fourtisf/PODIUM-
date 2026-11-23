// Everything that needs @solana/web3.js and the Podium client. This module is only ever loaded
// with a dynamic import() from the wallet sheet, so it stays out of the main bundle.
// DEVNET / LOCAL VALIDATOR ONLY: the cluster and the RPC URL are checked against mainnet by name
// and by genesis hash before anything is sent.
import { CLUSTERS, assertCluster, assertNotMainnetGenesis, assertRpcUrl, buildDepositTx, fetchPlayer, toBase } from '@podium/chain/browser';
import type { ChainConfigResponse } from '@podium/shared';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

/** The part of a Solana wallet provider used for transactions. */
export interface TxProvider {
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signTransaction?(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction?(tx: Transaction): Promise<{ signature: string }>;
}

export class WalletProblem extends Error {}

let conn: { url: string; connection: Connection } | null = null;
async function connection(cfg: ChainConfigResponse): Promise<Connection> {
  const cluster = assertCluster(cfg.cluster ?? ''); // throws for anything but localnet / devnet
  const url = assertRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || CLUSTERS[cluster.name].rpcUrl);
  if (conn?.url === url) return conn.connection;
  const c = new Connection(url, 'confirmed');
  await assertNotMainnetGenesis(c); // whatever the URL says
  conn = { url, connection: c };
  return c;
}

async function sameWallet(provider: TxProvider, wallet: string): Promise<void> {
  const connected = (await provider.connect()).publicKey.toBase58();
  if (connected !== wallet) throw new WalletProblem('Your wallet app is on another account. Switch it to the wallet linked here.');
}

/** Whole test tokens the wallet holds outside the game. */
export async function walletTokens(cfg: ChainConfigResponse, wallet: string): Promise<number> {
  const c = await connection(cfg);
  try {
    const bal = await c.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(cfg.mint!), new PublicKey(wallet), true));
    return Math.floor(Number(BigInt(bal.value.amount) / BigInt(cfg.unit)));
  } catch {
    return 0; // no token account yet
  }
}

/** Builds the deposit, has the wallet sign it, sends it to the configured cluster and waits for it. Returns the signature. */
export async function sendDeposit(cfg: ChainConfigResponse, provider: TxProvider, wallet: string, chips: number): Promise<string> {
  if (!Number.isSafeInteger(chips) || chips < 1) throw new WalletProblem('Enter a whole number of tChips.');
  await sameWallet(provider, wallet);
  const c = await connection(cfg);
  const owner = new PublicKey(wallet);
  const programId = new PublicKey(cfg.programId!);
  if ((await walletTokens(cfg, wallet)) < chips) throw new WalletProblem('Your wallet does not hold that many test tokens.');
  const registered = (await fetchPlayer(c, owner, programId)) !== null;
  const bh = await c.getLatestBlockhash('confirmed');
  const tx = buildDepositTx({ wallet: owner, mint: new PublicKey(cfg.mint!), amount: toBase(chips, BigInt(cfg.unit)), recentBlockhash: bh.blockhash, register: !registered, programId });
  let signature: string;
  if (provider.signTransaction) {
    // Signed in the wallet, sent by us: it can only go to the cluster checked above.
    const signed = await provider.signTransaction(tx);
    signature = await c.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
  } else if (provider.signAndSendTransaction) {
    signature = (await provider.signAndSendTransaction(tx)).signature;
  } else throw new WalletProblem('This wallet cannot sign transactions.');
  const res = await c.confirmTransaction({ signature, ...bh }, 'confirmed');
  if (res.value.err) throw new WalletProblem('The deposit transaction failed. Nothing was moved.');
  return signature;
}

/** Has the wallet sign the withdrawal the server prepared. The server co-signs and sends it. */
export async function signWithdrawal(provider: TxProvider, wallet: string, unsignedBase64: string): Promise<string> {
  if (!provider.signTransaction) throw new WalletProblem('This wallet cannot sign a transaction without sending it.');
  await sameWallet(provider, wallet);
  const signed = await provider.signTransaction(Transaction.from(Buffer.from(unsignedBase64, 'base64')));
  return Buffer.from(signed.serialize({ requireAllSignatures: false })).toString('base64');
}

// Phase 3 on Solana DEVNET / a LOCAL VALIDATOR only, with a valueless test token. Everything the
// API knows about the chain hangs off one ChainService (ctx.chain); it is null while CHAIN_MODE
// is off, and there is no setting that makes it talk to mainnet.
import { existsSync, readFileSync } from 'node:fs';
import {
  CLUSTERS, LOCAL_TEST_PROGRAM_ID, MAINNET_LOCKED_MESSAGE, Operator, TOKEN_DECIMALS, assertCluster, assertNotMainnetGenesis, assertRpcUrl,
  fetchPlayer, setProgramId, toBase, toChips, type ClusterName, type ConfigAccount, type PlayerAccount,
} from '@podium/chain';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import type { ChainSettings } from '../config';
import type { Logger } from '../ctx';
import { connectionRpc, type ChainRpc } from './rpc';

/** Genesis hash of the public devnet: CHAIN_MODE=devnet accepts no other cluster. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** A keypair from a JSON file path or from the JSON array itself. */
export function loadKeypair(setting: string, name: string): Keypair {
  const v = setting.trim();
  if (!v) throw new Error(`${name} is not set`);
  let text = v;
  if (!v.startsWith('[')) {
    if (!existsSync(v)) throw new Error(`${name}: no keypair file at ${v}`);
    text = readFileSync(v, 'utf8');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not a JSON keypair`);
  }
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error(`${name} is not a 64-byte JSON keypair`);
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
}

function pubkey(v: string, name: string): PublicKey {
  try {
    return new PublicKey(v);
  } catch {
    throw new Error(`${name} is not set to a Solana address`);
  }
}

export class ChainService {
  /** Wallets known to have a Player account in the program. */
  private readonly registered = new Set<string>();

  private constructor(
    readonly mode: ClusterName,
    readonly rpc: ChainRpc,
    readonly operator: Operator,
    private readonly operatorKp: Keypair,
    readonly programId: PublicKey,
    readonly mint: PublicKey,
    /** Fixed at initialize: unit, fee and burn never change. */
    private readonly fixed: ConfigAccount,
    /** The test mint's authority, or null: the faucet is off. */
    readonly faucetKeypair: Keypair | null,
    readonly faucetAmount: number,
  ) {}

  /**
   * Checks the settings and the cluster, and refuses anything that is or could be mainnet.
   * Throws (the server does not start) on any doubt.
   */
  static async create(s: ChainSettings, log: Logger, injected?: ChainRpc): Promise<ChainService> {
    if (s.mode !== 'localnet' && s.mode !== 'devnet') throw new Error(MAINNET_LOCKED_MESSAGE);
    const cluster = assertCluster(s.mode); // throws for anything but localnet / devnet
    let rpc = injected;
    if (!rpc) {
      const url = assertRpcUrl(s.rpcUrl || CLUSTERS[cluster.name].rpcUrl); // throws for a mainnet URL
      if (cluster.name === 'localnet' && !LOOPBACK.has(new URL(url).hostname)) {
        throw new Error(`CHAIN_MODE=localnet needs a validator on this machine, not ${new URL(url).hostname}. ${MAINNET_LOCKED_MESSAGE}`);
      }
      rpc = connectionRpc(new Connection(url, 'confirmed'));
    } else if (typeof rpc.rpcEndpoint === 'string') assertRpcUrl(rpc.rpcEndpoint);
    // Whatever the URL says: ask the node which cluster it is.
    await assertNotMainnetGenesis(rpc);
    if (cluster.name === 'devnet' && (await rpc.getGenesisHash()) !== DEVNET_GENESIS_HASH) {
      throw new Error(`CHAIN_MODE=devnet, but the RPC node is not on devnet. ${MAINNET_LOCKED_MESSAGE}`);
    }
    const programId = pubkey(s.programId, 'PODIUM_PROGRAM_ID');
    if (cluster.name === 'devnet' && programId.equals(LOCAL_TEST_PROGRAM_ID)) {
      throw new Error('PODIUM_PROGRAM_ID is the public LOCAL TEST id; anyone can deploy at that address. Use your own program id on devnet.');
    }
    const mint = pubkey(s.mint, 'PODIUM_MINT');
    const operatorKp = loadKeypair(s.operatorKeypair, 'CHAIN_OPERATOR_KEYPAIR');
    setProgramId(programId);
    const operator = new Operator(rpc, operatorKp, { programId });
    const cfg = await operator.config(true); // throws when the program is not initialized here
    if (!cfg.mint.equals(mint)) throw new Error(`PODIUM_MINT does not match the program's mint (${cfg.mint.toBase58()})`);
    if (!cfg.operator.equals(operatorKp.publicKey)) throw new Error(`CHAIN_OPERATOR_KEYPAIR (${operatorKp.publicKey.toBase58()}) is not the program's operator (${cfg.operator.toBase58()})`);
    const faucet = s.faucetKeypair ? loadKeypair(s.faucetKeypair, 'CHAIN_FAUCET_KEYPAIR') : null;
    log.info({ mode: cluster.name, programId: programId.toBase58(), mint: mint.toBase58(), faucet: !!faucet }, 'chain mode is on: TEST token, no value');
    return new ChainService(cluster.name, rpc, operator, operatorKp, programId, mint, cfg, faucet, Math.max(1, Math.floor(s.faucetAmount)));
  }

  get unit(): bigint {
    return this.fixed.unit;
  }
  get feeBps(): number {
    return this.fixed.feeBps;
  }
  get burnBps(): number {
    return this.fixed.burnBps;
  }
  readonly decimals = TOKEN_DECIMALS;

  /** Whole tChips to base units of the token. */
  toBase(chips: number): bigint {
    return toBase(chips, this.unit);
  }
  /** Base units to whole tChips, rounded down. */
  toChips(base: bigint): number {
    return toChips(base, this.unit);
  }

  private vest: { at: number; seconds: number } | null = null;
  /** The reward vesting delay. The admin may change it on-chain, so it is re-read once a minute. */
  async vestSeconds(): Promise<number> {
    if (!this.vest || Date.now() - this.vest.at > 60_000) {
      try {
        this.vest = { at: Date.now(), seconds: Number((await this.operator.config(true)).vestSeconds) };
      } catch (e) {
        if (!this.vest) throw e;
      }
    }
    return this.vest!.seconds;
  }

  /** Signs with `payer` alone, sends and confirms. Used for the faucet and for creating token accounts. */
  async sendAs(payer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
    const bh = await this.rpc.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    const signature = await this.rpc.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
    const res = await this.rpc.confirmTransaction({ signature, ...bh }, 'confirmed');
    if (res.value.err) throw new Error('transaction failed: ' + JSON.stringify(res.value.err));
    return signature;
  }

  /** Makes sure the wallet's associated token account of the test mint exists (the operator pays). Idempotent. */
  async ensureTokenAccount(wallet: string): Promise<PublicKey> {
    const owner = new PublicKey(wallet);
    const ata = getAssociatedTokenAddressSync(this.mint, owner, true);
    if (!(await this.rpc.getAccountInfo(ata))) {
      await this.sendAs(this.operatorKp, [createAssociatedTokenAccountIdempotentInstruction(this.operatorKp.publicKey, ata, owner, this.mint)]);
    }
    return ata;
  }

  player(wallet: string): Promise<PlayerAccount | null> {
    return fetchPlayer(this.rpc, new PublicKey(wallet), this.programId);
  }

  /** Creates the wallet's Player account when it has none (the operator pays). Idempotent. */
  async ensureRegistered(wallet: string): Promise<void> {
    if (this.registered.has(wallet)) return;
    await this.operator.registerPlayer(new PublicKey(wallet));
    this.registered.add(wallet);
  }
}

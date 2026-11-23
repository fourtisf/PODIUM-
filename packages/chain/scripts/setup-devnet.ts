// One-time setup of Podium on DEVNET, for the owner to run with their own keypairs.
// Creates a valueless 6-decimal test mint, initializes the program's config and vault, funds the
// rewards pot, and prints the addresses as env lines. It never requests an airdrop: fund the admin
// wallet with devnet SOL yourself first (about 0.05 SOL is enough).
//
//   PODIUM_PROGRAM_ID=<deployed program id> \
//   PODIUM_ADMIN_KEYPAIR=~/podium/admin.json \
//   PODIUM_OPERATOR_PUBKEY=<game server key> \
//   pnpm --filter @podium/chain setup:devnet -- --yes
//
// Optional: PODIUM_CLUSTER (devnet | localnet, default devnet), PODIUM_RPC_URL (a devnet RPC),
// PODIUM_TREASURY_OWNER (wallet that receives fee withdrawals, default the admin),
// PODIUM_REWARDS_CHIPS (default 1000000), PODIUM_VEST_SECONDS (default 604800 = 7 days),
// PODIUM_MINT (reuse an existing test mint instead of creating one).
import { createInterface } from 'node:readline/promises';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  DEFAULT_BURN_BPS,
  DEFAULT_FEE_BPS,
  DEFAULT_UNIT,
  DEFAULT_VEST_SECONDS,
  LOCAL_TEST_PROGRAM_ID,
  assertCluster,
  assertNotMainnetGenesis,
  assertRpcUrl,
  buildFundRewardsIx,
  buildInitializeIx,
  configPda,
  fetchConfig,
  toBase,
  toChips,
  vaultPda,
} from '../src/index';
import { TEST_TOKEN_NAME, createTestMint, loadKeypair, mintTo, send } from './lib';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (see the header of scripts/setup-devnet.ts)`);
  return v;
}

async function main(): Promise<void> {
  const cluster = assertCluster(process.env.PODIUM_CLUSTER ?? 'devnet'); // throws for mainnet
  const rpcUrl = assertRpcUrl(process.env.PODIUM_RPC_URL ?? cluster.rpcUrl);
  const programId = new PublicKey(need('PODIUM_PROGRAM_ID'));
  if (cluster.name === 'devnet' && programId.equals(LOCAL_TEST_PROGRAM_ID)) {
    throw new Error('PODIUM_PROGRAM_ID is the public LOCAL TEST id. Build and deploy with your own program keypair for devnet.');
  }
  const admin = loadKeypair(need('PODIUM_ADMIN_KEYPAIR'));
  const operator = new PublicKey(need('PODIUM_OPERATOR_PUBKEY'));
  const treasuryOwner = new PublicKey(process.env.PODIUM_TREASURY_OWNER ?? admin.publicKey.toBase58());
  const rewardsChips = Number(process.env.PODIUM_REWARDS_CHIPS ?? 1_000_000);
  const vestSeconds = BigInt(process.env.PODIUM_VEST_SECONDS ?? DEFAULT_VEST_SECONDS);

  const connection = new Connection(rpcUrl, 'confirmed');
  await assertNotMainnetGenesis(connection); // whatever the URL says

  const program = await connection.getAccountInfo(programId);
  if (!program?.executable) throw new Error(`No program at ${programId.toBase58()} on ${cluster.name}. Deploy it first (scripts/deploy-devnet.sh).`);

  const existing = await connection.getAccountInfo(configPda(programId));
  if (existing) {
    const c = await fetchConfig(connection, programId);
    console.error('Already initialized; nothing changed. Current settings:');
    printEnv(cluster.name, rpcUrl, programId, c.mint, c.treasuryWallet, c.admin, c.operator);
    return;
  }

  console.error(`
Podium setup on ${cluster.name.toUpperCase()} (${rpcUrl})
  program        ${programId.toBase58()}
  admin          ${admin.publicKey.toBase58()}  (pays, becomes admin and mint authority)
  operator       ${operator.toBase58()}
  treasury owner ${treasuryOwner.toBase58()}
  token          ${process.env.PODIUM_MINT ?? `new mint: "${TEST_TOKEN_NAME}"`}
  fee ${DEFAULT_FEE_BPS} bps, burn ${DEFAULT_BURN_BPS} bps, vesting ${vestSeconds}s, rewards pot ${rewardsChips} chips
The admin, operator, mint, treasury wallet, fee and burn cannot be changed afterwards (operator can).
`);
  if (!process.argv.includes('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question(`Type "${cluster.name}" to continue: `);
    rl.close();
    if (answer.trim() !== cluster.name) throw new Error('Cancelled.');
  }

  const mint = process.env.PODIUM_MINT ? new PublicKey(process.env.PODIUM_MINT) : await createTestMint(connection, admin);
  const treasuryWallet = await mintTo(connection, mint, admin, treasuryOwner, 0n);
  await send(
    connection,
    [buildInitializeIx({ admin: admin.publicKey, operator, mint, treasuryWallet, feeBps: DEFAULT_FEE_BPS, burnBps: DEFAULT_BURN_BPS, vestSeconds, unit: DEFAULT_UNIT }, programId)],
    [admin],
  );
  const c = await fetchConfig(connection, programId);
  if (!c.admin.equals(admin.publicKey)) throw new Error('Config was initialized by someone else. Do not use this deployment.');

  if (rewardsChips > 0) {
    const amount = toBase(rewardsChips, DEFAULT_UNIT);
    const adminAta = await mintTo(connection, mint, admin, admin.publicKey, amount);
    await send(connection, [buildFundRewardsIx(admin.publicKey, adminAta, amount, programId)], [admin]);
  }
  const after = await fetchConfig(connection, programId);
  console.error(`Done. Rewards pot: ${toChips(after.rewardsBalance, after.unit)} chips.`);
  printEnv(cluster.name, rpcUrl, programId, mint, treasuryWallet, admin.publicKey, operator);
}

function printEnv(cluster: string, rpcUrl: string, programId: PublicKey, mint: PublicKey, treasuryWallet: PublicKey, admin: PublicKey, operator: PublicKey): void {
  console.log(
    [
      `PODIUM_CLUSTER=${cluster}`,
      `PODIUM_RPC_URL=${rpcUrl}`,
      `PODIUM_PROGRAM_ID=${programId.toBase58()}`,
      `NEXT_PUBLIC_PODIUM_PROGRAM_ID=${programId.toBase58()}`,
      `PODIUM_MINT=${mint.toBase58()}`,
      `PODIUM_CONFIG=${configPda(programId).toBase58()}`,
      `PODIUM_VAULT=${vaultPda(programId).toBase58()}`,
      `PODIUM_TREASURY_WALLET=${treasuryWallet.toBase58()}`,
      `PODIUM_ADMIN=${admin.toBase58()}`,
      `PODIUM_OPERATOR=${operator.toBase58()}`,
      `PODIUM_TOKEN_DECIMALS=6`,
      `PODIUM_TOKEN_NAME="${TEST_TOKEN_NAME}"`,
    ].join('\n'),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

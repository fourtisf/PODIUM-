// LOCAL VALIDATOR ONLY. Sets up everything CHAIN_MODE=localnet needs on a fresh
// `solana-test-validator` that has the Podium program loaded, and prints the env lines.
// It only ever talks to 127.0.0.1 and uses the local validator's own airdrop.
//
//   solana-test-validator --reset --ledger /tmp/podium-test-ledger \
//     --bpf-program Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz programs/podium/target/deploy/podium.so &
//   pnpm --filter @podium/api exec tsx scripts/localnet-setup.ts <directory for the keypair files>
//
// Optional env: VEST_SECONDS (default 604800), REWARDS_CHIPS (default 1000000).
// The keypair files it writes are for the local validator only. Keep the directory outside the repo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLUSTERS, DEFAULT_BURN_BPS, DEFAULT_FEE_BPS, DEFAULT_UNIT, DEFAULT_VEST_SECONDS, LOCAL_TEST_PROGRAM_ID, TOKEN_DECIMALS, assertNotMainnetGenesis,
  buildFundRewardsIx, buildInitializeIx, configPda, fetchConfig, toBase,
} from '@podium/chain';
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, createMintToInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from '@solana/web3.js';

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: tsx scripts/localnet-setup.ts <directory for the keypair files>');
  const out = resolve(dir);
  mkdirSync(out, { recursive: true });
  const programId = LOCAL_TEST_PROGRAM_ID;
  const connection = new Connection(CLUSTERS.localnet.rpcUrl, 'confirmed'); // http://127.0.0.1:8899, nothing else
  await assertNotMainnetGenesis(connection);
  if (!(await connection.getAccountInfo(programId))?.executable) throw new Error('The Podium program is not loaded in the local validator (see the header of this file).');
  if (await connection.getAccountInfo(configPda(programId))) throw new Error('This validator is already initialized: restart it with --reset.');

  const admin = Keypair.generate();
  const operator = Keypair.generate();
  const save = (name: string, kp: Keypair): string => {
    const f = resolve(out, name);
    writeFileSync(f, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
    return f;
  };
  const send = (ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> => sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
  for (const kp of [admin, operator]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, 'confirmed');
  }

  // A valueless 6-decimal test mint; the admin is its authority (and so the local faucet key).
  const mint = Keypair.generate();
  await send(
    [
      SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint.publicKey, TOKEN_DECIMALS, admin.publicKey, null),
    ],
    [admin, mint],
  );
  const treasuryOwner = Keypair.generate().publicKey;
  const treasuryWallet = getAssociatedTokenAddressSync(mint.publicKey, treasuryOwner);
  const adminAta = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
  const rewards = toBase(Number(process.env.REWARDS_CHIPS ?? 1_000_000), DEFAULT_UNIT);
  await send(
    [
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasuryWallet, treasuryOwner, mint.publicKey),
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminAta, admin.publicKey, mint.publicKey),
      buildInitializeIx(
        { admin: admin.publicKey, operator: operator.publicKey, mint: mint.publicKey, treasuryWallet, feeBps: DEFAULT_FEE_BPS, burnBps: DEFAULT_BURN_BPS, vestSeconds: BigInt(process.env.VEST_SECONDS ?? DEFAULT_VEST_SECONDS), unit: DEFAULT_UNIT },
        programId,
      ),
    ],
    [admin],
  );
  if (rewards > 0n) await send([createMintToInstruction(mint.publicKey, adminAta, admin.publicKey, rewards), buildFundRewardsIx(admin.publicKey, adminAta, rewards, programId)], [admin]);
  const cfg = await fetchConfig(connection, programId);
  console.error(`Initialized on the local validator. Rewards pot: ${cfg.rewardsBalance / cfg.unit} chips, vesting ${cfg.vestSeconds}s.`);
  console.log(
    [
      'CHAIN_MODE=localnet',
      `PODIUM_PROGRAM_ID=${programId.toBase58()}`,
      `PODIUM_MINT=${mint.publicKey.toBase58()}`,
      `CHAIN_OPERATOR_KEYPAIR=${save('localnet-operator-keypair.json', operator)}`,
      `CHAIN_FAUCET_KEYPAIR=${save('localnet-admin-keypair.json', admin)}`,
      'NEXT_PUBLIC_CHAIN_MODE=localnet',
      `NEXT_PUBLIC_PODIUM_PROGRAM_ID=${programId.toBase58()}`,
      `NEXT_PUBLIC_PODIUM_MINT=${mint.publicKey.toBase58()}`,
      `NEXT_PUBLIC_SOLANA_RPC_URL=${CLUSTERS.localnet.rpcUrl}`,
    ].join('\n'),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

// End-to-end check against a LOCAL validator, through real RPC (the vitest suite runs in-process).
// Start a validator with the built program preloaded, then run this:
//
//   pnpm --filter @podium/chain build:program
//   solana-test-validator --reset --quiet --ledger /tmp/podium-test-ledger \
//     --bpf-program Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz programs/podium/target/deploy/podium.so &
//   pnpm --filter @podium/chain smoke:localnet
//
// It only ever talks to 127.0.0.1 and uses the local validator's own faucet.
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  CLUSTERS,
  DEFAULT_BURN_BPS,
  DEFAULT_FEE_BPS,
  DEFAULT_UNIT,
  LOCAL_TEST_PROGRAM_ID,
  Operator,
  PodiumProgramError,
  buildDepositTx,
  buildFundRewardsIx,
  buildInitializeIx,
  buildWithdrawTx,
  fetchConfig,
  fetchPlayer,
  liabilities,
  parsePodiumLogs,
  poolPda,
  toBase,
  vaultPda,
} from '../src/index';
import { createTestMint, mintTo, send } from './lib';

const programId = LOCAL_TEST_PROGRAM_ID;
const chips = (n: number) => toBase(n, DEFAULT_UNIT);

function check(cond: unknown, what: string): void {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
}

async function main(): Promise<void> {
  const connection = new Connection(CLUSTERS.localnet.rpcUrl, 'confirmed');
  const admin = Keypair.generate();
  const operatorKp = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  for (const kp of [admin, operatorKp, alice, bob]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, 'confirmed');
  }
  if (await connection.getAccountInfo(vaultPda(programId))) throw new Error('This validator is already initialized: restart it with --reset.');

  const mint = await createTestMint(connection, admin, false);
  const treasuryWallet = await mintTo(connection, mint, admin, Keypair.generate().publicKey, 0n);
  await send(
    connection,
    [buildInitializeIx({ admin: admin.publicKey, operator: operatorKp.publicKey, mint, treasuryWallet, feeBps: DEFAULT_FEE_BPS, burnBps: DEFAULT_BURN_BPS, vestSeconds: 2, unit: DEFAULT_UNIT }, programId)],
    [admin],
  );
  const adminAta = await mintTo(connection, mint, admin, admin.publicKey, chips(1000));
  await send(connection, [buildFundRewardsIx(admin.publicKey, adminAta, chips(1000), programId)], [admin]);
  check((await fetchConfig(connection, programId)).rewardsBalance === chips(1000), 'initialize + fund_rewards');

  const op = new Operator(connection, operatorKp, { programId });
  const aliceAta = await mintTo(connection, mint, admin, alice.publicKey, chips(500));
  await mintTo(connection, mint, admin, bob.publicKey, chips(500));

  // Players deposit with the transaction the web app would build.
  for (const kp of [alice, bob]) {
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = buildDepositTx({ wallet: kp.publicKey, mint, amount: chips(500), recentBlockhash: blockhash, register: true, programId });
    tx.sign(kp);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, 'confirmed');
  }
  check((await fetchPlayer(connection, alice.publicKey, programId))!.available === chips(500), 'register + deposit through RPC');

  // Operator instructions with sequence numbers.
  let seq = await op.opSeq();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const periodStart = now - 100n;
  const pool = poolPda(0, 'blaster', periodStart, programId);
  await op.createPool(++seq, { kind: 0, game: 'blaster', periodStart, periodEnd: now - 1n, entry: chips(100), splitBps: [5000, 3000, 2000], winners: 3 });
  await op.enterPool(++seq, pool, alice.publicKey);
  const enter = await op.enterPool(++seq, pool, bob.publicKey);
  check(enter.applied && enter.signature, 'create_pool + enter_pool');
  check(!(await op.enterPool(seq, pool, bob.publicKey)).applied, 'a retried seq is reported as already applied');

  let rejected: unknown;
  await op.closePool(seq + 1n, pool, [{ wallet: alice.publicKey, payout: chips(200) }]).catch((e) => (rejected = e));
  check(rejected instanceof PodiumProgramError && rejected.code === 'PayoutTooHigh', 'program errors are decoded from real RPC errors');
  const close = await op.closePool(++seq, pool, [
    { wallet: alice.publicKey, payout: chips(94) },
    { wallet: bob.publicKey, payout: chips(56) },
  ]);
  const tx = await connection.getTransaction(close.signature!, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  check(parsePodiumLogs(tx?.meta?.logMessages ?? []).some((e) => e.event === 'close_pool' && e.fields.fee === String(chips(50))), 'close_pool logs the fee for the indexer');

  const id = '3f2b8c1e-9d4a-4b7e-8f01-23456789abcd';
  await op.duelOpen(++seq, { id, creator: alice.publicKey, stake: chips(100), expiresAt: now + 3600n });
  await op.duelJoin(++seq, id, bob.publicKey);
  await op.duelSettle(++seq, id, alice.publicKey, chips(188));
  await op.spend(++seq, bob.publicKey, chips(300), chips(30));
  await op.creditReward(++seq, bob.publicKey, chips(150));
  check((await op.opSeq()) === seq, 'duel, spend and credit_reward');

  // Withdrawal: the player signs, the operator co-signs and sends.
  const a = (await fetchPlayer(connection, alice.publicKey, programId))!;
  check(a.available === chips(500 - 100 + 94 - 100 + 188), 'alice balance is as expected');
  const { blockhash } = await connection.getLatestBlockhash();
  const wtx = buildWithdrawTx({ wallet: alice.publicKey, mint, amount: a.available, operator: operatorKp.publicKey, recentBlockhash: blockhash, programId });
  wtx.partialSign(alice);
  await op.submitWithdraw(wtx.serialize({ requireAllSignatures: false }), { wallet: alice.publicKey, amount: a.available });
  const bal = await connection.getTokenAccountBalance(aliceAta);
  check(BigInt(bal.value.amount) === a.available, 'co-signed withdrawal reached the wallet');

  const c = await fetchConfig(connection, programId);
  const vault = BigInt((await connection.getTokenAccountBalance(vaultPda(programId))).value.amount);
  check(vault === liabilities(c), `vault (${vault}) covers the ledger exactly`);
  check(c.totalBurned === chips(30), 'burn recorded');
  console.log('localnet smoke test passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

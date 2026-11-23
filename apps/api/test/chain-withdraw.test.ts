// Withdrawals of the test token: prepare (reserve) → the wallet signs → submit (the server
// co-signs and sends). Against the REAL program, in-process.
import { buildWithdrawTx } from '@podium/chain';
import { STREAK, type ChainStatusResponse, type WithdrawPrepareResponse, type WithdrawSubmitResponse } from '@podium/shared';
import { Transaction } from '@solana/web3.js';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { drainChainOps } from '../src/chain/outbox';
import { WITHDRAW_WAIT, sweepWithdrawals } from '../src/chain/withdrawals';
import { setFlagged } from '../src/services/users';
import { CHAIN_READY, assertParity, chainApp, drain, onChain, walletUser, type ChainTest, type WalletClient } from './chain-helpers';
import { GAME, errCode, ledgerCount, signUp, visitor } from './helpers';

const DAY = 86_400_000;

describe.skipIf(!CHAIN_READY)('withdrawals', () => {
  let t: ChainTest;
  beforeAll(async () => {
    t = await chainApp();
    WITHDRAW_WAIT.ms = 0; // a submit that cannot confirm answers "submitted" at once
  });
  afterEach(() => assertParity(t));
  afterAll(() => t.close());
  const chips = (n: number): bigint => t.ctx.chain!.toBase(n);
  const status = async (c: WalletClient): Promise<ChainStatusResponse> => (await c.get<ChainStatusResponse>('/chain/status')).body;
  const prepare = (c: WalletClient, amount: number, idem?: string) => c.post<WithdrawPrepareResponse>('/chain/withdraw/prepare', { amount }, { idem });
  /** What the wallet's signTransaction does. */
  const sign = (c: WalletClient, unsigned: string): string => {
    const tx = Transaction.from(Buffer.from(unsigned, 'base64'));
    tx.partialSign(c.kp);
    return tx.serialize({ requireAllSignatures: false }).toString('base64');
  };
  const submit = (c: WalletClient, withdrawId: string, signedTx: string) => c.post<WithdrawSubmitResponse>('/chain/withdraw/submit', { withdrawId, signedTx });
  const wallet = (c: WalletClient): Promise<bigint> => t.world.tokenBalance(c.kp.publicKey);

  test('withdrawals need a signed-in account with a wallet and an Idempotency-Key', async () => {
    expect((await (await visitor(t)).post('/chain/withdraw/prepare', { amount: 10 })).status).toBe(401);
    expect(errCode(await (await signUp(t)).post('/chain/withdraw/prepare', { amount: 10 }))).toBe('wallet_required');
    const a = await walletUser(t, { deposit: 100 });
    expect((await a.post('/chain/withdraw/prepare', { amount: 10 }, { idem: null })).status).toBe(400);
    for (const amount of [0, -5, 1.5, '10']) expect((await a.post('/chain/withdraw/prepare', { amount })).status, String(amount)).toBe(400);
    expect(errCode(await prepare(a, 101))).toBe('not_enough_chips');
    expect((await submit(a, 'nope', 'AAAA')).status).toBe(404);
    expect(await ledgerCount(t, a.id, 'withdraw')).toBe(0);
  });

  test('prepare reserves, the wallet signs, submit co-signs and sends: ledger and chain agree afterwards', async () => {
    const a = await walletUser(t, { tokens: 1000, deposit: 1000 });
    expect(await wallet(a)).toBe(0n);
    const p = await prepare(a, 400, 'withdraw-key-0001');
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ amount: 400, balance: 600 });
    expect(await a.balance()).toBe(600); // reserved at once
    expect((await status(a)).openWithdrawal).toEqual({ id: p.body.withdrawId, amount: 400, status: 'prepared' });
    // The same request again is the same withdrawal and the same transaction.
    expect((await prepare(a, 400, 'withdraw-key-0001')).body).toEqual(p.body);
    expect(await a.balance()).toBe(600);
    // The prepared transaction is exactly the one-instruction withdraw the client package builds.
    const unsigned = Transaction.from(Buffer.from(p.body.transaction, 'base64'));
    expect(unsigned.instructions).toHaveLength(1);
    expect(unsigned.feePayer!.equals(a.kp.publicKey)).toBe(true);
    const signed = sign(a, p.body.transaction);
    // Nobody else can submit it.
    expect((await submit(await walletUser(t), p.body.withdrawId, signed)).status).toBe(404);

    const s = await submit(a, p.body.withdrawId, signed);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ withdrawId: p.body.withdrawId, status: 'confirmed', balance: 600 });
    expect(s.body.signature).toBeTruthy();
    expect(await wallet(a)).toBe(chips(400));
    expect(await onChain(t, a)).toBe(600);
    expect(await a.balance()).toBe(600);
    // Submitting again changes nothing and sends nothing.
    const sent = t.world.rpc.sent;
    expect((await submit(a, p.body.withdrawId, signed)).body).toEqual(s.body);
    expect(t.world.rpc.sent).toBe(sent);
    expect(await wallet(a)).toBe(chips(400));
    expect(await ledgerCount(t, a.id, 'withdraw')).toBe(1);
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(0);
    expect(await status(a)).toMatchObject({ onchain: { available: 600, locked: 0 }, withdrawable: 600, dbBalance: 600, openWithdrawal: null });
    // The token account was missing before prepare created it; a second withdrawal reuses it.
    const p2 = await prepare(a, 600);
    expect((await submit(a, p2.body.withdrawId, sign(a, p2.body.transaction))).body.status).toBe('confirmed');
    expect(await wallet(a)).toBe(chips(1000));
    expect(await a.balance()).toBe(0);
  });

  test('a withdrawal is refused while operations are still settling, while tChips are vesting, and on hold', async () => {
    const a = await walletUser(t, { deposit: 500, unlocked: true });
    // Still settling: the ranked entry is queued but not on-chain yet.
    expect((await a.post('/runs', { game: GAME, mode: 'ranked' })).status).toBe(200);
    const settling = await prepare(a, 100);
    expect(settling.status).toBe(409);
    expect(errCode(settling)).toBe('conflict');
    expect((settling.body as unknown as { error: { message: string } }).error.message).toContain('still settling');
    await drain(t);
    // Vesting: 400 deposited tChips are free, the 100 reward tChips are not.
    expect((await a.post('/streak/claim')).status).toBe(200);
    await drain(t);
    expect(await status(a)).toMatchObject({ onchain: { available: 400, locked: STREAK[0] }, withdrawable: 400, dbBalance: 500 });
    const vesting = await prepare(a, 450);
    expect(vesting.status).toBe(409);
    expect((vesting.body as unknown as { error: { message: string } }).error.message).toContain('Only 400 tChips');
    expect(await a.balance()).toBe(500);
    expect(await t.ctx.db.withdrawal.count({ where: { userId: a.id } })).toBe(0);
    // On hold (a rejected operation) or under review: nothing leaves.
    await t.ctx.db.user.update({ where: { id: a.id }, data: { chainHold: true } });
    const held = await prepare(a, 50);
    expect(held.status).toBe(403);
    expect(errCode(held)).toBe('forbidden');
    expect((await status(a)).hold).toBe(true);
    expect((await status(a)).withdrawable).toBe(0);
    await t.ctx.db.user.update({ where: { id: a.id }, data: { chainHold: false } });
    await setFlagged(t.ctx, a.id, true);
    expect((await prepare(a, 50)).status).toBe(403);
    await drain(t);
    expect((await t.world.player(a.kp.publicKey))!.frozen).toBe(true); // frozen on-chain as well
    expect((await prepare(a, 50)).status).toBe(403);
    await setFlagged(t.ctx, a.id, false);
    await drain(t);
    expect((await t.world.player(a.kp.publicKey))!.frozen).toBe(false);
    // Once the vesting delay has passed everything can go.
    t.advance(7 * DAY + 60_000);
    const p = await prepare(a, 500);
    expect(p.status).toBe(200);
    expect((await submit(a, p.body.withdrawId, sign(a, p.body.transaction))).body.status).toBe('confirmed');
    expect(await wallet(a)).toBe(chips(500));
  });

  test('an expired withdrawal returns the reservation exactly once and can never land', async () => {
    const a = await walletUser(t, { deposit: 300 });
    const p = await prepare(a, 200);
    expect(await a.balance()).toBe(100);
    const signed = sign(a, p.body.transaction);
    await t.world.passBlocks(200); // past lastValidBlockHeight
    expect(await sweepWithdrawals(t.ctx)).toBe(1);
    expect(await a.balance()).toBe(300);
    expect(await sweepWithdrawals(t.ctx)).toBe(0);
    expect((await status(a)).openWithdrawal).toBeNull();
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(1);
    expect((await t.ctx.db.withdrawal.findUniqueOrThrow({ where: { id: p.body.withdrawId } })).status).toBe('expired');
    // The signed transaction arrives late: it is not co-signed and nothing moves.
    const sent = t.world.rpc.sent;
    const late = await submit(a, p.body.withdrawId, signed);
    expect(late.body).toMatchObject({ status: 'expired', balance: 300 });
    expect(t.world.rpc.sent).toBe(sent);
    expect(await wallet(a)).toBe(0n);
    expect(await onChain(t, a)).toBe(300);
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(1);
  });

  test('GET /chain/status settles an expired withdrawal too', async () => {
    const a = await walletUser(t, { deposit: 300 });
    await prepare(a, 120);
    await t.world.passBlocks(200);
    expect(await status(a)).toMatchObject({ dbBalance: 300, openWithdrawal: null, withdrawable: 300 });
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(1);
  });

  test('only the prepared transaction is co-signed: another amount, another blockhash or an unsigned one is refused', async () => {
    const a = await walletUser(t, { deposit: 300 });
    const chain = t.ctx.chain!;
    const p = await prepare(a, 100);
    const good = Transaction.from(Buffer.from(p.body.transaction, 'base64'));
    const forge = (amount: number, blockhash: string): string => {
      const tx = buildWithdrawTx({ wallet: a.kp.publicKey, mint: chain.mint, amount: chips(amount), operator: chain.operator.publicKey, recentBlockhash: blockhash, programId: chain.programId });
      tx.partialSign(a.kp);
      return tx.serialize({ requireAllSignatures: false }).toString('base64');
    };
    const sent = t.world.rpc.sent;
    // Not signed by the wallet.
    expect((await submit(a, p.body.withdrawId, p.body.transaction)).status).toBe(400);
    // More than was reserved, on the prepared blockhash.
    const more = await submit(a, p.body.withdrawId, forge(300, good.recentBlockhash!));
    expect(more.status).toBe(400);
    expect(errCode(more)).toBe('invalid');
    // The right amount on a newer blockhash (it would outlive the reservation's expiry).
    await t.world.rpc.expireBlockhash();
    const newer = (await t.world.rpc.getLatestBlockhash()).blockhash;
    expect(newer).not.toBe(good.recentBlockhash);
    expect((await submit(a, p.body.withdrawId, forge(100, newer))).status).toBe(400);
    expect((await submit(a, p.body.withdrawId, 'AAAA')).status).toBe(400);
    expect(t.world.rpc.sent).toBe(sent);
    expect((await t.ctx.db.withdrawal.findUniqueOrThrow({ where: { id: p.body.withdrawId } })).status).toBe('prepared');
    expect(await wallet(a)).toBe(0n);
    // The real one still works.
    expect((await submit(a, p.body.withdrawId, sign(a, p.body.transaction))).body.status).toBe('confirmed');
    expect(await wallet(a)).toBe(chips(100));
  });

  test('one open withdrawal at a time: a new prepare replaces one that was never submitted', async () => {
    const a = await walletUser(t, { deposit: 300 });
    const first = await prepare(a, 100);
    const firstSigned = sign(a, first.body.transaction);
    const second = await prepare(a, 250);
    expect(second.status).toBe(200);
    expect(second.body.withdrawId).not.toBe(first.body.withdrawId);
    expect(await a.balance()).toBe(50); // the first reservation came back, the second was taken
    expect(await t.ctx.db.withdrawal.count({ where: { userId: a.id, status: { in: ['prepared', 'submitted'] } } })).toBe(1);
    // The replaced one is dead: its signed transaction is never co-signed.
    const sent = t.world.rpc.sent;
    expect((await submit(a, first.body.withdrawId, firstSigned)).body.status).toBe('expired');
    expect(t.world.rpc.sent).toBe(sent);
    expect((await submit(a, second.body.withdrawId, sign(a, second.body.transaction))).body.status).toBe('confirmed');
    expect(await wallet(a)).toBe(chips(250));
    expect(await a.balance()).toBe(50);
  });

  test('a send whose answer is lost is followed up on-chain, never paid back while it can still land', async () => {
    const a = await walletUser(t, { deposit: 300 });
    // 1. The node is unreachable: nothing was broadcast, the withdrawal stays submitted.
    const p = await prepare(a, 100);
    const signed = sign(a, p.body.transaction);
    t.world.rpc.failSends = 1;
    const lost = await submit(a, p.body.withdrawId, signed);
    expect(lost.body).toMatchObject({ status: 'submitted', balance: 200 });
    expect(await sweepWithdrawals(t.ctx)).toBe(0); // the blockhash is still valid: no refund yet
    expect(await a.balance()).toBe(200);
    // A second prepare has to wait for it.
    expect((await prepare(a, 50)).status).toBe(409);
    // The same signed transaction again: co-signed again (same transaction id) and sent.
    const retry = await submit(a, p.body.withdrawId, signed);
    expect(retry.body).toMatchObject({ status: 'confirmed', signature: lost.body.signature });
    expect(await wallet(a)).toBe(chips(100));

    // 2. The transaction LANDS and the answer is lost: confirmed from the chain, no refund.
    const p2 = await prepare(a, 100);
    t.world.rpc.loseAnswers = 1;
    expect((await submit(a, p2.body.withdrawId, sign(a, p2.body.transaction))).body.status).toBe('confirmed');
    expect(await wallet(a)).toBe(chips(200));
    expect(await a.balance()).toBe(100);
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(0);

    // 3. Never sent and the blockhash runs out: the reservation comes back once.
    const p3 = await prepare(a, 100);
    t.world.rpc.failSends = 1;
    expect((await submit(a, p3.body.withdrawId, sign(a, p3.body.transaction))).body.status).toBe('submitted');
    await t.world.passBlocks(200);
    expect(await sweepWithdrawals(t.ctx)).toBe(1);
    expect(await a.balance()).toBe(100);
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(1);
    expect(await wallet(a)).toBe(chips(200));
  });

  test('a withdrawal the program refuses is failed and refunded once', async () => {
    const a = await walletUser(t, { deposit: 300 });
    const p = await prepare(a, 100);
    // Frozen on-chain after the prepare (as a review would do).
    await setFlagged(t.ctx, a.id, true);
    await drain(t);
    await t.ctx.db.user.update({ where: { id: a.id }, data: { flagged: false } }); // the ledger flag alone would stop it earlier
    const s = await submit(a, p.body.withdrawId, sign(a, p.body.transaction));
    expect(s.body).toMatchObject({ status: 'failed', balance: 300 });
    expect(await wallet(a)).toBe(0n);
    expect(await ledgerCount(t, a.id, 'withdraw_refund')).toBe(1);
    expect((await submit(a, p.body.withdrawId, sign(a, p.body.transaction))).body.status).toBe('failed');
    expect(await a.balance()).toBe(300);
    // With the ledger flag set, submit stops before co-signing and gives the reservation back.
    await t.ctx.db.user.update({ where: { id: a.id }, data: { flagged: true } });
    await setFlagged(t.ctx, a.id, false);
    await drain(t);
    await t.ctx.db.user.update({ where: { id: a.id }, data: { flagged: false } });
    const p2 = await prepare(a, 100);
    await t.ctx.db.user.update({ where: { id: a.id }, data: { chainHold: true } });
    expect((await submit(a, p2.body.withdrawId, sign(a, p2.body.transaction))).status).toBe(403);
    expect(await a.balance()).toBe(300);
    expect(await drainChainOps(t.ctx)).toMatchObject({ applied: 0, failed: 0 });
  });
});

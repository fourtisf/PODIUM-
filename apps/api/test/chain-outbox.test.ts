// The outbox worker: order, sequence numbers, recovery after a crash, rejected operations, and
// the rewards-pot cap. Against the REAL program, in-process.
import { poolPda } from '@podium/chain';
import { STREAK, type StreakClaimResponse } from '@podium/shared';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { drainChainOps, withChainLock } from '../src/chain/outbox';
import { weeklyPeriod } from '../src/services/periods';
import { CHAIN_READY, assertParity, chainApp, drain, onChain, walletUser, type ChainTest, type WalletClient } from './chain-helpers';
import { GAME, errCode } from './helpers';

describe.skipIf(!CHAIN_READY)('outbox worker', () => {
  let t: ChainTest;
  beforeAll(async () => void (t = await chainApp()));
  afterEach(async () => {
    t.world.rpc.failSends = t.world.rpc.loseAnswers = t.world.rpc.dropConfirmations = 0;
    await assertParity(t);
  });
  afterAll(() => t.close());
  const chips = (n: number): bigint => t.ctx.chain!.toBase(n);
  const opSeq = async (): Promise<bigint> => (await t.world.config()).opSeq;
  const enter = async (c: WalletClient): Promise<string> => {
    const r = await c.post<{ runId: string }>('/runs', { game: GAME, mode: 'ranked' });
    expect(r.status).toBe(200);
    return 'entry:' + r.body.runId;
  };
  const op = (ref: string) => t.ctx.db.chainOp.findUniqueOrThrow({ where: { ref } });

  test('operations are applied in id order, one sequence number each, by one worker at a time', async () => {
    const a = await walletUser(t, { deposit: 500 });
    const b = await walletUser(t, { deposit: 500 });
    const refs = [await enter(a), await enter(b), await enter(a)];
    const before = await opSeq();
    // While another worker holds the lock this one does nothing.
    expect(await withChainLock(t.ctx, () => drainChainOps(t.ctx))).toMatchObject({ ran: false, applied: 0 });
    expect(await opSeq()).toBe(before);
    const queued = await t.ctx.db.chainOp.count({ where: { status: 'pending' } });
    const r = await drain(t);
    expect(r).toMatchObject({ ran: true, applied: queued, failed: 0 });
    const done = await Promise.all(refs.map(op));
    expect(done.map((o) => o.status)).toEqual(['applied', 'applied', 'applied']);
    expect(done[1]!.seq).toBe(done[0]!.seq! + 1n);
    expect(done[2]!.seq).toBe(done[1]!.seq! + 1n);
    expect(await opSeq()).toBe(done[2]!.seq);
    expect(await opSeq()).toBe(before + BigInt(queued));
    // Nothing left: draining again sends nothing.
    const sent = t.world.rpc.sent;
    expect(await drain(t)).toMatchObject({ applied: 0, failed: 0 });
    expect(t.world.rpc.sent).toBe(sent);
  });

  test('an operation the program rejects is marked failed, the player is put on hold, and the queue goes on with the same number', async () => {
    const a = await walletUser(t, { deposit: 100 });
    const b = await walletUser(t, { deposit: 100 });
    await drain(t);
    // Out of band, A's on-chain balance is emptied, so the ledger is ahead of the chain for A.
    await t.ctx.chain!.operator.spend((await opSeq()) + 1n, a.kp.publicKey, chips(100), 0n);
    const refA = await enter(a);
    const refB = await enter(b);
    const next = (await opSeq()) + 1n;
    const r = await drainChainOps(t.ctx);
    expect(r).toMatchObject({ ran: true, applied: 1, failed: 1, stalled: null });
    expect(await op(refA)).toMatchObject({ status: 'failed', error: 'InsufficientBalance', seq: null, signature: null });
    // The number A's operation did not consume went to the next one.
    expect(await op(refB)).toMatchObject({ status: 'applied', seq: next });
    expect(await opSeq()).toBe(next);
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: a.id } })).chainHold).toBe(true);
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: b.id } })).chainHold).toBe(false);
    // A cannot withdraw until someone has looked at it; B is not affected.
    const held = await a.post('/chain/withdraw/prepare', { amount: 1 });
    expect(held.status).toBe(403);
    expect(errCode(held)).toBe('forbidden');
    expect(await onChain(t, b)).toBe(0);
    expect(await b.balance()).toBe(0);
    // A failed operation is not retried.
    expect(await drain(t)).toMatchObject({ applied: 0, failed: 0 });
    t.outOfStep.add(a.id);
  });

  test('restart with a sent operation: applied on-chain already → marked applied without sending again', async () => {
    const a = await walletUser(t, { deposit: 300 });
    await drain(t);
    const ref = await enter(a);
    const period = await weeklyPeriod(t.ctx.db, GAME, t.now());
    const seq = (await opSeq()) + 1n;
    // The worker stored the number, sent the transaction, and died before recording the result.
    await t.ctx.db.chainOp.update({ where: { ref }, data: { status: 'sent', seq, attempts: 1 } });
    await t.ctx.chain!.operator.enterPool(seq, poolPda(0, GAME, Math.floor(+period.startAt / 1000), t.world.programId), a.kp.publicKey);
    expect(await opSeq()).toBe(seq);
    const sent = t.world.rpc.sent;
    expect(await drain(t)).toMatchObject({ applied: 1, failed: 0 });
    expect(t.world.rpc.sent).toBe(sent); // nothing was sent twice
    expect(await op(ref)).toMatchObject({ status: 'applied', seq });
    expect(await onChain(t, a)).toBe(200);
  });

  test('restart with a sent operation that never reached the chain → sent again with the same number', async () => {
    const a = await walletUser(t, { deposit: 300 });
    await drain(t);
    const ref = await enter(a);
    const seq = (await opSeq()) + 1n;
    await t.ctx.db.chainOp.update({ where: { ref }, data: { status: 'sent', seq, attempts: 1 } });
    expect(await drain(t)).toMatchObject({ applied: 1, failed: 0 });
    expect(await op(ref)).toMatchObject({ status: 'applied', seq, attempts: 2 });
    expect((await op(ref)).signature).toBeTruthy();
    expect(await opSeq()).toBe(seq);
    expect(await onChain(t, a)).toBe(200);
  });

  test('network errors are retried in place: nothing is skipped, nothing is applied twice', async () => {
    const a = await walletUser(t, { deposit: 300 });
    const b = await walletUser(t, { deposit: 300 });
    await drain(t);
    const refA = await enter(a);
    const refB = await enter(b);
    const seq = (await opSeq()) + 1n;
    // The node cannot be reached: the first operation waits, the second is not sent ahead of it.
    t.world.rpc.failSends = 1;
    const down = await drainChainOps(t.ctx);
    expect(down).toMatchObject({ applied: 0, failed: 0 });
    expect(down.stalled).toContain('enterPool');
    expect(await op(refA)).toMatchObject({ status: 'sent', seq });
    expect(await op(refB)).toMatchObject({ status: 'pending', seq: null });
    expect(await opSeq()).toBe(seq - 1n);
    expect(await t.ctx.db.user.count({ where: { id: { in: [a.id, b.id] }, chainHold: true } })).toBe(0);
    // The transaction lands but the answer is lost: the operator sees the chain reached the number.
    t.world.rpc.loseAnswers = 1;
    expect(await drain(t)).toMatchObject({ applied: 2, failed: 0 });
    expect(await op(refA)).toMatchObject({ status: 'applied', seq });
    expect(await op(refB)).toMatchObject({ status: 'applied', seq: seq + 1n });
    expect(await opSeq()).toBe(seq + 1n);
    expect(await onChain(t, a)).toBe(200);
    expect(await onChain(t, b)).toBe(200);
    // A lost confirmation is the same story.
    const refC = await enter(a);
    t.world.rpc.dropConfirmations = 1;
    expect(await drain(t)).toMatchObject({ applied: 1, failed: 0 });
    expect(await op(refC)).toMatchObject({ status: 'applied', seq: seq + 2n });
    expect(await onChain(t, a)).toBe(100);
  });

  test('a paused program makes the queue wait; nobody is put on hold', async () => {
    const a = await walletUser(t, { deposit: 300 });
    await drain(t);
    const ref = await enter(a);
    await t.world.setPaused(true);
    const r = await drainChainOps(t.ctx);
    expect(r).toMatchObject({ applied: 0, failed: 0 });
    expect(r.stalled).toContain('Paused');
    expect((await op(ref)).status).toBe('sent');
    expect((await t.ctx.db.user.findUniqueOrThrow({ where: { id: a.id } })).chainHold).toBe(false);
    await t.world.setPaused(false);
    expect(await drain(t)).toMatchObject({ applied: 1, failed: 0 });
    expect(await onChain(t, a)).toBe(200);
  });
});

describe.skipIf(!CHAIN_READY)('rewards pot', () => {
  let t: ChainTest;
  beforeAll(async () => void (t = await chainApp({ chain: { rewardsChips: 150 } })));
  afterEach(() => assertParity(t));
  afterAll(() => t.close());

  test('rewards are capped by what is left of the on-chain pot, counting the ones still queued', async () => {
    const [a, b, c] = [await walletUser(t, { unlocked: true }), await walletUser(t, { unlocked: true }), await walletUser(t, { unlocked: true })];
    const claim = (u: WalletClient) => u.post<StreakClaimResponse>('/streak/claim');
    // Nothing is drained in between: the second and third claim only see the database's reservation.
    expect((await claim(a!)).body).toMatchObject({ chips: STREAK[0], nominal: STREAK[0], scaled: false });
    expect((await claim(b!)).body).toMatchObject({ chips: 50, nominal: STREAK[0], scaled: true, balance: 50 });
    expect((await claim(c!)).body).toMatchObject({ chips: 0, nominal: STREAK[0], scaled: true, balance: 0 });
    expect(await t.ctx.db.chainOp.count({ where: { kind: 'creditReward' } })).toBe(2);
    expect(await drain(t)).toMatchObject({ applied: 2, failed: 0 });
    expect((await t.world.config()).rewardsBalance).toBe(0n);
    expect(await onChain(t, a!)).toBe(100);
    expect(await onChain(t, b!)).toBe(50);
    expect(await onChain(t, c!)).toBe(0);
    // An empty pot pays nothing, and nothing is queued that the program would reject.
    const d = await walletUser(t, { unlocked: true });
    expect((await claim(d)).body).toMatchObject({ chips: 0, scaled: true });
    expect(await t.ctx.db.chainOp.count({ where: { kind: 'creditReward' } })).toBe(2);
    expect(await t.ctx.db.chainOp.count({ where: { status: 'failed' } })).toBe(0);
  });
});

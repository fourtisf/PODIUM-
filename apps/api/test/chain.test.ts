// Chain mode end to end against the REAL program (in-process): accounts, wallet link, deposits,
// pool entries, the weekly close, duels, the shop burn and vesting rewards. After every test the
// ledger balance of every user equals what the wallet holds on-chain.
import { DUEL_STATE } from '@podium/chain';
import {
  DUEL_JOINER_TIMEOUT_HOURS, ECONOMY, REFERRAL, STREAK, duelFee, duelPayout, splitPool,
  type AuthResponse, type ChainStatusResponse, type CreateDuelResponse, type ShopBuyResponse, type ShopResponse, type StartRunResponse, type StreakClaimResponse,
} from '@podium/shared';
import bs58 from 'bs58';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { canonicalSignature } from '../src/chain/deposits';
import { chainDuelId, drainChainOps } from '../src/chain/outbox';
import { logsOfProgram } from '../src/chain/rpc';
import { closeDuePeriods } from '../src/services/close';
import { expireDuels } from '../src/services/duels';
import { weeklyPeriod } from '../src/services/periods';
import { CHAIN_READY, assertParity, chainApp, deposit, drain, linkWallet, onChain, signMessage, walletUser, type ChainTest } from './chain-helpers';
import { GAME, OTHER_GAME, distinctPlans, errCode, guest, ledgerCount, playRun, signUp, visitor, type Client } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe.skipIf(!CHAIN_READY)('chain mode', () => {
  let t: ChainTest;
  beforeAll(async () => void (t = await chainApp()));
  afterEach(() => assertParity(t));
  afterAll(() => t.close());
  const chips = (n: number): bigint => t.ctx.chain!.toBase(n);
  const status = async (c: Client): Promise<ChainStatusResponse> => (await c.get<ChainStatusResponse>('/chain/status')).body;

  test('every account starts at 0, there is no refill, and practice is free', async () => {
    const g = await guest(t);
    expect(await g.balance()).toBe(0);
    const e = await signUp(t);
    const me = await e.me();
    expect(me.user.balance).toBe(0);
    expect(me.canRefill).toBe(false);
    expect(me.chain).toEqual({ mode: 'localnet', wallet: null, needsWallet: true });
    for (const c of [g, e]) {
      const r = await c.post('/refill');
      expect(r.status).toBe(403);
      expect(errCode(r)).toBe('forbidden');
      expect((r.body as { error: { message: string } }).error.message).toContain('no refill');
    }
    expect(await ledgerCount(t, e.id)).toBe(0);
    const w = await walletUser(t);
    expect(await w.balance()).toBe(0);
    expect((await w.me()).chain).toEqual({ mode: 'localnet', wallet: w.address, needsWallet: false });
    // Signing in registered the wallet in the program (the operator paid).
    expect(await t.world.player(w.kp.publicKey)).toMatchObject({ available: 0n, locked: 0n, frozen: false });
    // Practice is not pooled anywhere, so it never charges: more runs than the free ones, still 0 and no ledger row.
    for (let i = 0; i < ECONOMY.freePracticeRuns + 2; i++) {
      const r = await playRun(g, GAME, 'practice');
      expect(r.start.body.entry).toBe(0);
      expect(r.finish.status).toBe(200);
    }
    expect(await g.balance()).toBe(0);
    expect(await ledgerCount(t, g.id)).toBe(0);
    expect(await t.ctx.db.chainOp.count({ where: { userId: g.id } })).toBe(0);
  });

  test('value features need a linked wallet; a wallet links once, to one account', async () => {
    const e = await signUp(t, { unlocked: true });
    for (const r of [
      await e.post('/runs', { game: GAME, mode: 'ranked' }),
      await e.post('/duels', { game: GAME, stake: 50 }),
      await e.post('/shop/buy', { kind: 'box' }),
      await e.post('/boxes/open'),
      await e.post('/streak/claim'),
      await e.post('/chain/withdraw/prepare', { amount: 1 }),
      await e.post('/chain/deposit/confirm', { signature: '1'.repeat(88) }),
    ]) {
      expect(r.status).toBe(403);
      expect(errCode(r)).toBe('wallet_required');
    }
    // Challenge runs and practice are free and stay open without a wallet.
    expect((await e.post('/runs', { game: GAME, mode: 'practice' })).status).toBe(200);

    const kp = await t.world.wallet(300);
    const address = kp.publicKey.toBase58();
    expect(errCode(await (await guest(t)).post('/auth/wallet/link', { address, signature: signMessage(kp, 'x') }))).toBe('guest_not_allowed');
    expect((await (await visitor(t)).post('/auth/wallet/link', { address, signature: signMessage(kp, 'x') })).status).toBe(401);
    await e.post('/auth/wallet/nonce', { address });
    const bad = await e.post('/auth/wallet/link', { address, signature: signMessage(kp, 'not the message') });
    expect(bad.status).toBe(400);
    expect((await e.me()).chain!.wallet).toBeNull();

    const linked = await linkWallet(e, kp);
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ ok: true, userId: e.id, created: false });
    expect((await e.me()).chain).toEqual({ mode: 'localnet', wallet: address, needsWallet: false });
    expect(await t.world.player(kp.publicKey)).not.toBeNull();
    expect((await linkWallet(e, kp)).status).toBe(200); // linking the same wallet again changes nothing

    // The wallet belongs to that account now.
    const other = await signUp(t);
    const taken = await linkWallet(other, kp);
    expect(taken.status).toBe(409);
    expect(errCode(taken)).toBe('conflict');
    // And the account keeps its wallet: the tChips live under it on-chain.
    const second = await linkWallet(e, await t.world.wallet());
    expect(second.status).toBe(409);
    expect((await e.me()).chain!.wallet).toBe(address);
    // Signing in with the wallet lands in the same account.
    const v = await visitor(t);
    const n = await v.post<{ message: string }>('/auth/wallet/nonce', { address });
    const signedIn = await v.post<AuthResponse>('/auth/wallet/verify', { address, signature: signMessage(kp, n.body.message), adult: true });
    expect(signedIn.body).toMatchObject({ userId: e.id, created: false });
    // Now the value features open (the balance is still 0, so the run is refused for that reason).
    const run = await e.post('/runs', { game: GAME, mode: 'ranked' });
    expect(errCode(run)).toBe('not_enough_chips');
    expect((run.body as { error: { message: string } }).error.message).not.toContain('Refill');
  });

  test('a confirmed deposit is credited once: a replay or another account submitting it credits nothing', async () => {
    const a = await walletUser(t, { tokens: 1000 });
    const b = await walletUser(t);
    expect((await (await visitor(t)).post('/chain/deposit/confirm', { signature: '1'.repeat(88) })).status).toBe(401);
    expect((await a.post('/chain/deposit/confirm', { signature: 'not-base58-0OIl' + 'x'.repeat(70) })).status).toBe(400);
    // A well-formed signature the node has never seen: not confirmed (yet).
    expect((await a.post('/chain/deposit/confirm', { signature: canonicalSignature(bs58.encode(Buffer.alloc(64, 7)))! })).status).toBe(404);

    const first = await deposit(t, a, 400);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ credited: 400, amount: 400, balance: 400 });
    expect(await t.world.tokenBalance(a.kp.publicKey)).toBe(chips(600));
    const again = await a.post('/chain/deposit/confirm', { signature: first.signature });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ credited: 0, amount: 400, balance: 400 });
    // Someone else reporting A's transaction gets nothing, and A is not credited again.
    const stolen = await b.post('/chain/deposit/confirm', { signature: first.signature });
    expect(stolen.status).toBe(400);
    expect(errCode(stolen)).toBe('invalid');
    expect(await b.balance()).toBe(0);
    expect(await a.balance()).toBe(400);
    expect(await ledgerCount(t, a.id, 'deposit')).toBe(1);
    expect((await t.ctx.db.ledger.findFirstOrThrow({ where: { userId: a.id, reason: 'deposit' } })).idemKey).toBe('deposit:' + first.signature);
    expect(await onChain(t, a)).toBe(400);

    // Reconcile: a deposit the browser never reported is found by GET /chain/status, once.
    const silent = await t.world.deposit(a.kp, chips(250));
    const st = await status(a);
    expect(st).toMatchObject({
      wallet: a.address, registered: true, onchain: { available: 650, locked: 0, unlockAt: null }, withdrawable: 650, dbBalance: 650, pendingOps: 0, hold: false, openWithdrawal: null, credited: 250,
    });
    expect((await status(a)).credited).toBe(0);
    expect((await a.post('/chain/deposit/confirm', { signature: silent })).body).toEqual({ credited: 0, amount: 250, balance: 650 });
    expect(await ledgerCount(t, a.id, 'deposit')).toBe(2);
  });

  test('a deposit that is not a whole number of tChips is refused', async () => {
    const a = await walletUser(t, { tokens: 10 });
    const sig = await t.world.deposit(a.kp, 1_500_000n);
    const r = await a.post('/chain/deposit/confirm', { signature: sig });
    expect(r.status).toBe(400);
    expect((r.body as { error: { message: string } }).error.message).toContain('whole number');
    expect(await a.balance()).toBe(0);
    expect((await status(a)).credited).toBe(0);
    t.outOfStep.add(a.id); // 1.5 tChips sit on-chain without a ledger credit
  });

  test('only what OUR program logged counts as a deposit', () => {
    const us = t.world.programId.toBase58();
    const line = 'Program log: podium:deposit wallet=W amount=5000000 available=5000000 locked=0';
    expect(logsOfProgram([`Program ${us} invoke [1]`, 'Program log: Instruction: Deposit', line, `Program ${us} consumed 1 of 2 compute units`, `Program ${us} success`], us)).toEqual(['Program log: Instruction: Deposit', line]);
    // Another program printing the same text, at the top level or around a call into ours.
    const evil = 'Evi1111111111111111111111111111111111111111';
    expect(logsOfProgram([`Program ${evil} invoke [1]`, line, `Program ${evil} success`], us)).toEqual([]);
    expect(logsOfProgram([`Program ${evil} invoke [1]`, line, `Program ${us} invoke [2]`, 'Program log: podium:register_player wallet=W', `Program ${us} success`, line, `Program ${evil} success`], us)).toEqual(['Program log: podium:register_player wallet=W']);
    expect(logsOfProgram([`Program ${us} invoke [1]`, line, 'Log truncated'], us)).toBeNull();
  });

  test('a ranked entry is mirrored with enter_pool: the on-chain pool equals the ledger pool', async () => {
    const a = await walletUser(t, { deposit: 500 });
    const b = await walletUser(t, { deposit: 300 });
    const r1 = await playRun(a, OTHER_GAME, 'ranked');
    expect(r1.start.body).toMatchObject({ entry: ECONOMY.rankedEntry, balance: 400 });
    await playRun(b, OTHER_GAME, 'ranked');
    expect((await a.post<StartRunResponse>('/runs', { game: OTHER_GAME, mode: 'ranked' })).status).toBe(200);
    // Queued in the same transaction as the ledger rows, in order.
    const queued = await t.ctx.db.chainOp.findMany({ where: { kind: 'enterPool', status: 'pending' }, orderBy: { id: 'asc' } });
    expect(queued.map((o) => o.userId)).toEqual([a.id, b.id, a.id]);
    expect(queued[0]!.ref).toBe('entry:' + r1.start.body.runId);
    expect((await status(a)).pendingOps).toBe(2);
    await drain(t);
    const period = await weeklyPeriod(t.ctx.db, OTHER_GAME, t.now());
    expect(period.pool).toBe(300);
    const pool = (await t.world.pool(0, OTHER_GAME, Math.floor(+period.startAt / 1000)))!;
    expect(pool).toMatchObject({ total: chips(300), entries: 3, closed: false, entry: chips(ECONOMY.rankedEntry), feeBps: 600, winners: 3 });
    expect(pool.splitBps).toEqual([5000, 3000, 2000, 0, 0]);
    expect(Number(pool.periodEnd)).toBe(Math.floor(+period.endAt / 1000));
    expect(await onChain(t, a)).toBe(300);
    expect(await onChain(t, b)).toBe(200);
    const done = await t.ctx.db.chainOp.findMany({ where: { kind: 'enterPool' }, orderBy: { id: 'asc' } });
    expect(done.every((o) => o.status === 'applied' && o.signature && o.seq !== null)).toBe(true);
    expect(done.map((o) => o.seq)).toEqual([...done.map((o) => o.seq)].sort((x, y) => Number(x! - y!)));
    // A replayed start request queues nothing new.
    expect(await t.ctx.db.chainOp.count({ where: { kind: 'enterPool' } })).toBe(3);
  });

  test('the weekly close pays three wallets on-chain exactly what the ledger paid, and the treasury gets the fee', async () => {
    const [low, mid, high] = distinctPlans(GAME, t.seed, 3);
    const a = await walletUser(t, { deposit: 1000, name: 'First' });
    const b = await walletUser(t, { deposit: 1000, name: 'Second' });
    const c = await walletUser(t, { deposit: 1000, name: 'Third' });
    await playRun(c, GAME, 'ranked', { plan: low });
    await playRun(a, GAME, 'ranked', { plan: high });
    await playRun(b, GAME, 'ranked', { plan: mid });
    for (const p of [a, b, c]) expect((await p.post('/runs', { game: GAME, mode: 'ranked' })).status).toBe(200);
    expect((await a.post('/runs', { game: GAME, mode: 'ranked' })).status).toBe(200);
    const period = await weeklyPeriod(t.ctx.db, GAME, t.now());
    expect(period.pool).toBe(700);
    const { payouts } = splitPool(700, ECONOMY.weeklySplit, 3);
    expect(payouts).toEqual([329, 197, 132]);
    await drain(t);
    const treasuryBefore = (await t.world.config()).treasuryBalance;
    const start = Math.floor(+period.startAt / 1000);

    // The ledger closes first. While the chain's clock has not reached the period end the
    // close_pool waits in the queue (it is retried, not failed) and nobody is put on hold.
    const at = new Date(+period.endAt + 60_000);
    const report = await closeDuePeriods(t.ctx, at);
    const mine = report.closed.find((r) => r.periodId === period.id)!;
    expect(mine.payouts).toEqual([{ userId: a.id, place: 1, amount: 329 }, { userId: b.id, place: 2, amount: 197 }, { userId: c.id, place: 3, amount: 132 }]);
    const early = await drainChainOps(t.ctx);
    expect(early.stalled).toContain('PoolNotEnded');
    expect(early.failed).toBe(0);
    expect((await t.world.pool(0, GAME, start))!.closed).toBe(false);
    expect((await status(a)).pendingOps).toBeGreaterThan(0); // the payout is still on its way
    expect(await t.ctx.db.user.count({ where: { chainHold: true } })).toBe(0);

    t.setNow(at);
    await drain(t);
    const pool = (await t.world.pool(0, GAME, start))!;
    expect(pool).toMatchObject({ closed: true, total: chips(700), entries: 7 });
    expect(await a.balance()).toBe(1000 - 300 + 329);
    expect(await b.balance()).toBe(1000 - 200 + 197);
    expect(await c.balance()).toBe(1000 - 200 + 132);
    for (const p of [a, b, c]) {
      expect(await onChain(t, p), p.name).toBe(await p.balance());
      // Prizes funded by deposits are not vesting.
      expect((await t.world.player(p.kp.publicKey))!.locked).toBe(0n);
    }
    // The treasury got this pool's fee (and the fee of every other pool that closed with it).
    expect(mine.fee).toBe(700 - 329 - 197 - 132);
    expect(mine.fee).toBe(42);
    expect((await t.world.config()).treasuryBalance - treasuryBefore).toBe(chips(report.closed.reduce((x, r) => x + r.fee, 0)));
    // Running the close again queues nothing and pays nothing.
    expect(await closeDuePeriods(t.ctx)).toEqual({ ran: true, closed: [] });
    expect(await t.ctx.db.chainOp.count({ where: { kind: 'closePool', ref: 'close:' + period.id } })).toBe(1);
    // The next week's board has its on-chain pool.
    await drain(t);
    expect(await t.world.pool(0, GAME, Math.floor(+period.endAt / 1000))).toMatchObject({ closed: false, total: 0n });
  });

  test('a duel between two wallets: stakes in escrow, the winner is paid, the fee goes to the treasury', async () => {
    const stake = 100;
    const [low, high] = distinctPlans(GAME, t.seed, 2);
    const a = await walletUser(t, { deposit: 500, name: 'Creator' });
    const b = await walletUser(t, { deposit: 500, name: 'Joiner' });
    const treasuryBefore = (await t.world.config()).treasuryBalance;
    const escrowBefore = (await t.world.config()).totalEscrow;
    const created = await a.post<CreateDuelResponse>('/duels', { game: GAME, stake });
    expect(created.status).toBe(200);
    const duelId = created.body.duel.id;
    await drain(t);
    expect(await t.world.duel(chainDuelId(duelId))).toMatchObject({ state: DUEL_STATE.open, stake: chips(stake), joiner: null });
    expect((await t.world.config()).totalEscrow - escrowBefore).toBe(chips(stake));
    expect(await onChain(t, a)).toBe(400);
    await playRun(a, GAME, 'duel', { duelId, plan: low });
    const joined = await b.post<CreateDuelResponse>('/duels', { game: GAME, stake });
    expect(joined.body).toMatchObject({ role: 'joiner' });
    await drain(t);
    expect((await t.world.duel(chainDuelId(duelId)))!.state).toBe(DUEL_STATE.matched);
    const run = await playRun(b, GAME, 'duel', { duelId, plan: high });
    expect(run.finish.body.duel).toMatchObject({ won: true, payout: duelPayout(stake) });
    await drain(t);
    expect((await t.world.duel(chainDuelId(duelId)))!.state).toBe(DUEL_STATE.settled);
    expect(await a.balance()).toBe(400);
    expect(await b.balance()).toBe(400 + duelPayout(stake));
    expect(await onChain(t, a)).toBe(400);
    expect(await onChain(t, b)).toBe(400 + duelPayout(stake));
    expect((await t.world.config()).treasuryBalance - treasuryBefore).toBe(chips(duelFee(stake)));
    expect((await t.world.config()).totalEscrow).toBe(escrowBefore);
  });

  test('duel refund after 24 hours, and a joiner who never plays loses to the creator, both on-chain', async () => {
    const [low] = distinctPlans(GAME, t.seed, 1);
    const a = await walletUser(t, { deposit: 300 });
    const lonely = await a.post<CreateDuelResponse>('/duels', { game: OTHER_GAME, stake: 250 });
    expect(await a.balance()).toBe(50);
    const c = await walletUser(t, { deposit: 300 });
    const d = await walletUser(t, { deposit: 300 });
    const matched = await c.post<CreateDuelResponse>('/duels', { game: GAME, stake: 50 });
    await playRun(c, GAME, 'duel', { duelId: matched.body.duel.id, plan: low });
    t.advance((ECONOMY.duelExpiryHours - DUEL_JOINER_TIMEOUT_HOURS - 1) * HOUR);
    expect((await d.post<CreateDuelResponse>('/duels', { game: GAME, stake: 50 })).body.role).toBe('joiner');
    await drain(t);
    const treasuryBefore = (await t.world.config()).treasuryBalance;

    t.advance((DUEL_JOINER_TIMEOUT_HOURS + 1) * HOUR + 60_000);
    expect(await expireDuels(t.ctx, t.now())).toEqual({ refunded: 1, forfeited: 1 });
    expect(await a.balance()).toBe(300);
    await drain(t);
    expect((await t.world.duel(chainDuelId(lonely.body.duel.id)))!.state).toBe(DUEL_STATE.refunded);
    expect(await onChain(t, a)).toBe(300);
    expect((await t.world.duel(chainDuelId(matched.body.duel.id)))!.state).toBe(DUEL_STATE.settled);
    expect(await onChain(t, c)).toBe(250 + duelPayout(50));
    expect(await onChain(t, d)).toBe(250);
    expect((await t.world.config()).treasuryBalance - treasuryBefore).toBe(chips(duelFee(50)));
    // Running the job again changes nothing.
    expect(await expireDuels(t.ctx, t.now())).toEqual({ refunded: 0, forfeited: 0 });
    expect((await drain(t)).applied).toBe(0);
  });

  test('a shop purchase spends on-chain and burns 10% from the mint supply', async () => {
    const a = await walletUser(t, { deposit: 1000 });
    const supply = await t.world.supply();
    const before = await t.world.config();
    const burnedDb = (await a.get<ShopResponse>('/shop')).body.burned;
    const buy = await a.post<ShopBuyResponse>('/shop/buy', { kind: 'box' }, { idem: 'chain-shop-0001' });
    expect(buy.status).toBe(200);
    const burn = Math.round(ECONOMY.boxPrice * ECONOMY.shopBurn);
    expect(buy.body).toMatchObject({ price: ECONOMY.boxPrice, balance: 1000 - ECONOMY.boxPrice, burned: burnedDb + burn });
    expect((await a.post<ShopBuyResponse>('/shop/buy', { kind: 'box' }, { idem: 'chain-shop-0001' })).body).toEqual(buy.body);
    await drain(t);
    expect(await t.ctx.db.chainOp.count({ where: { kind: 'spend', userId: a.id } })).toBe(1);
    const after = await t.world.config();
    expect(supply - (await t.world.supply())).toBe(chips(burn));
    expect(after.totalBurned - before.totalBurned).toBe(chips(burn));
    expect(after.treasuryBalance - before.treasuryBalance).toBe(chips(ECONOMY.boxPrice - burn));
    expect(await onChain(t, a)).toBe(1000 - ECONOMY.boxPrice);
  });

  test('a reward is paid from the on-chain rewards pot and vests: playable at once, withdrawable later', async () => {
    const a = await walletUser(t, { unlocked: true });
    const pot = (await t.world.config()).rewardsBalance;
    const claim = await a.post<StreakClaimResponse>('/streak/claim', {}, { idem: 'chain-streak-01' });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ chips: STREAK[0], nominal: STREAK[0], scaled: false, balance: STREAK[0] });
    expect((await a.post('/streak/claim', {}, { idem: 'chain-streak-01' })).body).toEqual(claim.body);
    await drain(t);
    expect(await t.ctx.db.chainOp.count({ where: { kind: 'creditReward', userId: a.id } })).toBe(1);
    expect(pot - (await t.world.config()).rewardsBalance).toBe(chips(STREAK[0]));
    const p = (await t.world.player(a.kp.publicKey))!;
    expect(p).toMatchObject({ available: 0n, locked: chips(STREAK[0]) });
    const unlock = Math.floor(+t.now() / 1000) + 7 * 86_400;
    expect(Math.abs(Number(p.unlockAt) - unlock)).toBeLessThan(5);
    const st = await status(a);
    expect(st).toMatchObject({ onchain: { available: 0, locked: STREAK[0] }, withdrawable: 0, dbBalance: STREAK[0] });
    expect(Math.abs(+new Date(st.onchain.unlockAt!) / 1000 - unlock)).toBeLessThan(5);
    // Vesting tChips can be played with at once.
    expect((await a.post('/runs', { game: GAME, mode: 'ranked' })).status).toBe(200);
    await drain(t);
    expect(await t.world.player(a.kp.publicKey)).toMatchObject({ available: 0n, locked: 0n });
    expect(await a.balance()).toBe(0);
  });

  test('referral bonuses are rewards too: they wait for a wallet and vest on-chain', async () => {
    const inviter = await walletUser(t);
    const ref = (await inviter.me()).user.refCode;
    // Signed up by email: the bonus cannot be paid on-chain yet.
    const e = await signUp(t, { ref });
    expect(await e.balance()).toBe(0);
    expect(await ledgerCount(t, e.id, 'referral')).toBe(0);
    const kp = await t.world.wallet();
    expect((await linkWallet(e, kp)).status).toBe(200);
    expect(await e.balance()).toBe(REFERRAL.invitedBonus);
    expect((await linkWallet(e, kp)).status).toBe(200);
    expect(await ledgerCount(t, e.id, 'referral')).toBe(1);
    // Signed up with a wallet: paid at once.
    const w = await walletUser(t, { ref });
    expect(await w.balance()).toBe(REFERRAL.invitedBonus);
    await drain(t);
    expect(await t.world.player(kp.publicKey)).toMatchObject({ available: 0n, locked: chips(REFERRAL.invitedBonus) });
    expect(await t.world.player(w.kp.publicKey)).toMatchObject({ available: 0n, locked: chips(REFERRAL.invitedBonus) });
  });

  test('time passing unlocks vested rewards', async () => {
    const a = await walletUser(t, { unlocked: true });
    await a.post('/streak/claim');
    await drain(t);
    expect((await status(a)).withdrawable).toBe(0);
    t.advance(7 * DAY + 60_000);
    expect(await status(a)).toMatchObject({ onchain: { available: STREAK[0], locked: 0, unlockAt: null }, withdrawable: STREAK[0] });
  });
});

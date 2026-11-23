// Runs the BUILT program (programs/podium/target/deploy/podium.so) in-process with LiteSVM.
// Skipped, with a message, when the .so has not been built.
import { ECONOMY, duelFee, duelPayout, splitPool } from '@podium/shared';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction } from '@solana/spl-token';
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT,
  Operator,
  SequenceGapError,
  WithdrawCheckError,
  buildClosePoolIx,
  buildCreatePoolIx,
  buildCreditRewardIx,
  buildDepositTx,
  buildDuelSettleIx,
  buildEnterPoolIx,
  buildFundRewardsIx,
  buildRegisterPlayerIx,
  buildSetFrozenIx,
  buildSetOperatorIx,
  buildSetPausedIx,
  buildSetVestSecondsIx,
  buildTreasuryToRewardsIx,
  buildTreasuryWithdrawIx,
  buildWithdrawIx,
  buildWithdrawTx,
  fetchConfig,
  fetchDuel,
  fetchPlayer,
  fetchPool,
  matured,
  parsePodiumLogs,
  playerPda,
  poolPda,
  splitToBps,
  vaultPda,
} from '../src/index';
import { BUILD_HINT, PROGRAM_BUILT, T0, VEST, WEEK, World, chips, type TestPlayer } from './harness';

if (!PROGRAM_BUILT) console.warn(`\n${BUILD_HINT}\n`);

const UNIT = DEFAULT_UNIT;
const FEE_BPS = BigInt(Math.round(ECONOMY.fee * 10_000));
const code = (name: string) => ({ code: name });
/** Errors raised before the program's own checks: by Anchor's account validation or the system program. */
const ALREADY_IN_USE = { customCode: 0 }; // system program: the PDA already exists
const SEEDS_MISMATCH = { customCode: 2006 }; // Anchor ConstraintSeeds
const NOT_THAT_ACCOUNT_TYPE = { customCode: 3002 }; // Anchor AccountDiscriminatorMismatch
const NOT_INITIALIZED = { customCode: 3012 }; // Anchor AccountNotInitialized

describe.skipIf(!PROGRAM_BUILT)(PROGRAM_BUILT ? 'podium program' : `podium program (${BUILD_HINT})`, () => {
  let w: World;
  beforeEach(async () => {
    w = await World.create();
  });
  afterEach(() => {
    // Whatever a test did, the vault covers the ledger and the totals add up.
    w.checkInvariant();
  });

  /** Player-signed withdraw, co-signed by the operator key directly. */
  const withdraw = (p: TestPlayer, amount: bigint) =>
    w.send([buildWithdrawIx(p.wallet, w.operatorKp.publicKey, p.ata, amount, w.programId)], [p.kp, w.operatorKp]);

  // ------------------------------------------------------------------ initialize / admin

  describe('initialize and admin', () => {
    it('records the config and creates an empty vault owned by the config PDA', async () => {
      const c = await fetchConfig(w.conn, w.programId);
      expect(c.admin.equals(w.admin.publicKey)).toBe(true);
      expect(c.operator.equals(w.operatorKp.publicKey)).toBe(true);
      expect(c.mint.equals(w.mint)).toBe(true);
      expect(c.vault.equals(vaultPda(w.programId))).toBe(true);
      expect(c.treasuryWallet.equals(w.treasuryWallet)).toBe(true);
      expect(c).toMatchObject({ feeBps: 600, burnBps: 1000, vestSeconds: VEST, unit: UNIT, opSeq: 0n, paused: false });
      expect(c).toMatchObject({ treasuryBalance: 0n, rewardsBalance: 0n, totalPlayerBalance: 0n, totalEscrow: 0n, totalBurned: 0n });
      expect(w.vaultBalance()).toBe(0n);
    });

    it('cannot be initialized twice', async () => {
      const other = Keypair.generate();
      w.svm.airdrop(other.publicKey, 10_000_000_000n);
      await expect(w.send([w.initializeIx({ admin: other.publicKey, operator: other.publicKey })], [other])).rejects.toMatchObject(ALREADY_IN_USE);
      expect(w.config().admin.equals(w.admin.publicKey)).toBe(true);
    });

    it('rejects bad parameters', async () => {
      const fresh = await World.create({ init: false });
      await expect(fresh.send([fresh.initializeIx({ feeBps: 10_001 })], [fresh.admin])).rejects.toMatchObject(code('InvalidParam'));
      await expect(fresh.send([fresh.initializeIx({ unit: 0 })], [fresh.admin])).rejects.toMatchObject(code('InvalidParam'));
      await expect(fresh.send([fresh.initializeIx({ vestSeconds: -1 })], [fresh.admin])).rejects.toMatchObject(code('InvalidParam'));
      await fresh.initialize();
      w = fresh;
    });

    it('only the admin can use admin instructions', async () => {
      const mallory = Keypair.generate();
      w.svm.airdrop(mallory.publicKey, 10_000_000_000n);
      const ixs = [
        buildSetOperatorIx(mallory.publicKey, mallory.publicKey, w.programId),
        buildSetPausedIx(mallory.publicKey, true, w.programId),
        buildSetVestSecondsIx(mallory.publicKey, 0, w.programId),
        buildTreasuryToRewardsIx(mallory.publicKey, 1, w.programId),
        buildTreasuryWithdrawIx(mallory.publicKey, w.treasuryWallet, 1, w.programId),
      ];
      for (const ix of ixs) await expect(w.send([ix], [mallory])).rejects.toMatchObject(code('Unauthorized'));
      // The operator is not the admin either.
      await expect(w.send([buildSetPausedIx(w.operatorKp.publicKey, true, w.programId)], [w.operatorKp])).rejects.toMatchObject(code('Unauthorized'));
    });

    it('admin can change the operator, the vesting delay and pause', async () => {
      const newOp = Keypair.generate();
      w.svm.airdrop(newOp.publicKey, 10_000_000_000n);
      await w.send([buildSetOperatorIx(w.admin.publicKey, newOp.publicKey, w.programId)], [w.admin]);
      await w.send([buildSetVestSecondsIx(w.admin.publicKey, 60, w.programId)], [w.admin]);
      expect(w.config()).toMatchObject({ vestSeconds: 60n });
      // The old operator key no longer works; the new one does.
      const p = await w.player({ deposit: 100 });
      await expect(w.send([buildSetFrozenIx(w.operatorKp.publicKey, 1, p.wallet, true, w.programId)], [w.operatorKp])).rejects.toMatchObject(code('Unauthorized'));
      await w.send([buildSetFrozenIx(newOp.publicKey, 1, p.wallet, true, w.programId)], [newOp]);
      expect(w.playerAcc(p.wallet).frozen).toBe(true);
    });
  });

  // ------------------------------------------------------------------ deposit / withdraw

  describe('deposit and withdraw', () => {
    it('deposit moves tokens into the vault and credits available; withdraw reverses it', async () => {
      const p = await w.player({ tokens: 1000 });
      await w.deposit(p, chips(600));
      expect(w.playerAcc(p.wallet)).toMatchObject({ available: chips(600), locked: 0n });
      expect(w.tokenBalance(p.ata)).toBe(chips(400));
      expect(w.vaultBalance()).toBe(chips(600));
      expect(w.config().totalPlayerBalance).toBe(chips(600));

      const logs = await withdraw(p, chips(250));
      expect(parsePodiumLogs(logs)[0]).toMatchObject({ event: 'withdraw', fields: { amount: String(chips(250)), wallet: p.wallet.toBase58() } });
      expect(w.playerAcc(p.wallet).available).toBe(chips(350));
      expect(w.tokenBalance(p.ata)).toBe(chips(650));
      expect(w.vaultBalance()).toBe(chips(350));
    });

    it('buildDepositTx registers and deposits in one transaction', async () => {
      const p = await w.player({ tokens: 500, register: false });
      const tx = buildDepositTx({ wallet: p.wallet, mint: w.mint, amount: chips(500), recentBlockhash: w.svm.latestBlockhash(), register: true, programId: w.programId });
      tx.sign(p.kp);
      await w.conn.sendRawTransaction(tx.serialize());
      w.wallets.push(p.wallet);
      expect((await fetchPlayer(w.conn, p.wallet, w.programId))!.available).toBe(chips(500));
    });

    it('anyone can register a wallet, once', async () => {
      const wallet = Keypair.generate().publicKey;
      expect(await fetchPlayer(w.conn, wallet, w.programId)).toBeNull();
      expect(await w.op.registerPlayer(wallet)).toEqual(expect.any(String));
      expect(await w.op.registerPlayer(wallet)).toBeNull();
      w.wallets.push(wallet);
      expect(w.playerAcc(wallet)).toMatchObject({ available: 0n, locked: 0n, unlockAt: 0n, frozen: false });
      await expect(w.send([buildRegisterPlayerIx(w.admin.publicKey, wallet, w.programId)], [w.admin])).rejects.toMatchObject(ALREADY_IN_USE);
    });

    it('withdraw without the operator co-signature fails', async () => {
      const p = await w.player({ deposit: 500 });
      // (a) the operator account is passed but did not sign
      const ix = buildWithdrawIx(p.wallet, w.operatorKp.publicKey, p.ata, chips(100), w.programId);
      ix.keys[1]!.isSigner = false;
      await expect(w.send([ix], [p.kp])).rejects.toThrow(/AccountNotSigner|3010/);
      // (b) the player signs in the operator slot too
      await expect(w.send([buildWithdrawIx(p.wallet, p.wallet, p.ata, chips(100), w.programId)], [p.kp])).rejects.toMatchObject(code('Unauthorized'));
      // (c) some other key co-signs
      const mallory = Keypair.generate();
      await expect(
        w.send([buildWithdrawIx(p.wallet, mallory.publicKey, p.ata, chips(100), w.programId)], [p.kp, mallory]),
      ).rejects.toMatchObject(code('Unauthorized'));
      // (d) the transaction simply lacks the signature
      const tx = new Transaction();
      tx.feePayer = p.wallet;
      tx.recentBlockhash = w.svm.latestBlockhash();
      tx.add(buildWithdrawIx(p.wallet, w.operatorKp.publicKey, p.ata, chips(100), w.programId));
      tx.partialSign(p.kp);
      await expect(w.conn.sendRawTransaction(tx.serialize({ requireAllSignatures: false }))).rejects.toThrow(/Missing signature/);
      expect(w.playerAcc(p.wallet).available).toBe(chips(500));
    });

    it('the operator cannot withdraw without the player, nor to an account the player does not own', async () => {
      const p = await w.player({ deposit: 500 });
      const thief = await w.player({ tokens: 0 });
      // Operator signs alone in the wallet slot: it is not the player's wallet.
      await expect(
        w.send([buildWithdrawIx(w.operatorKp.publicKey, w.operatorKp.publicKey, thief.ata, chips(100), w.programId)], [w.operatorKp]),
      ).rejects.toMatchObject(NOT_INITIALIZED);
      // Player and operator both sign, but the destination belongs to someone else.
      await expect(
        w.send([buildWithdrawIx(p.wallet, w.operatorKp.publicKey, thief.ata, chips(100), w.programId)], [p.kp, w.operatorKp]),
      ).rejects.toThrow(/ConstraintTokenOwner|2015/);
      // Someone else's Player account cannot be drained by another wallet.
      const ix = buildWithdrawIx(thief.wallet, w.operatorKp.publicKey, thief.ata, chips(100), w.programId);
      ix.keys[3]!.pubkey = playerPda(p.wallet, w.programId);
      await expect(w.send([ix], [thief.kp, w.operatorKp])).rejects.toMatchObject(SEEDS_MISMATCH);
      expect(w.playerAcc(p.wallet).available).toBe(chips(500));
      expect(w.tokenBalance(thief.ata)).toBe(0n);
    });

    it('withdraw more than available fails', async () => {
      const p = await w.player({ deposit: 500 });
      await expect(withdraw(p, chips(500) + 1n)).rejects.toMatchObject(code('InsufficientBalance'));
      await expect(withdraw(p, 0n)).rejects.toMatchObject(code('InvalidAmount'));
      await withdraw(p, chips(500));
      await expect(withdraw(p, 1n)).rejects.toMatchObject(code('InsufficientBalance'));
    });

    it('a frozen player cannot withdraw', async () => {
      const p = await w.player({ deposit: 500 });
      await w.op.setFrozen(await w.next(), p.wallet, true);
      await expect(withdraw(p, chips(100))).rejects.toMatchObject(code('Frozen'));
      await w.op.setFrozen(await w.next(), p.wallet, false);
      await withdraw(p, chips(100));
      expect(w.playerAcc(p.wallet).available).toBe(chips(400));
    });

    it('pause blocks withdraw, deposit and operator instructions', async () => {
      const p = await w.player({ tokens: 1000, deposit: 500 });
      await w.send([buildSetPausedIx(w.admin.publicKey, true, w.programId)], [w.admin]);
      await expect(withdraw(p, chips(100))).rejects.toMatchObject(code('Paused'));
      await expect(w.deposit(p, chips(100))).rejects.toMatchObject(code('Paused'));
      await expect(w.op.setFrozen(await w.next(), p.wallet, true)).rejects.toMatchObject(code('Paused'));
      await expect(w.op.creditReward(await w.next(), p.wallet, 1)).rejects.toMatchObject(code('Paused'));
      expect(w.config().opSeq).toBe(0n);
      await w.send([buildSetPausedIx(w.admin.publicKey, false, w.programId)], [w.admin]);
      await withdraw(p, chips(100));
    });

    it('deposit needs the wallet itself and its own token account', async () => {
      const p = await w.player({ deposit: 100, tokens: 300 });
      const other = await w.player({ tokens: 300 });
      // other pays from its account into p's Player account slot: the seeds do not match.
      const dep = buildDepositTx({ wallet: other.wallet, mint: w.mint, amount: chips(10), recentBlockhash: w.svm.latestBlockhash(), programId: w.programId });
      dep.instructions[0]!.keys[2]!.pubkey = playerPda(p.wallet, w.programId);
      dep.sign(other.kp);
      await expect(w.conn.sendRawTransaction(dep.serialize())).rejects.toThrow(/Custom\(2006\)/);
      expect(w.playerAcc(p.wallet).available).toBe(chips(100));
    });
  });

  // ------------------------------------------------------------------ pools

  describe('pools', () => {
    it('create_pool fixes entry, fee and split; they match the request', async () => {
      const start = w.now();
      const address = await w.createPool({ game: 'hopper', periodStart: start });
      expect(address.equals(poolPda(0, 'hopper', start, w.programId))).toBe(true);
      const pool = (await fetchPool(w.conn, 0, 'hopper', start, w.programId))!;
      expect(pool).toMatchObject({
        kind: 0, game: 'hopper', periodStart: start, periodEnd: start + WEEK, entry: chips(100), feeBps: 600,
        splitBps: [5000, 3000, 2000, 0, 0], winners: 3, total: 0n, lockedPart: 0n, entries: 0, closed: false,
      });
      // The same pool cannot be created again (which is also why its terms cannot be changed).
      const again = buildCreatePoolIx(
        w.operatorKp.publicKey,
        { seq: await w.next(), kind: 0, game: 'hopper', periodStart: start, periodEnd: start + WEEK, entry: chips(1), splitBps: [10_000], winners: 1 },
        w.programId,
      );
      await expect(w.send([again], [w.operatorKp])).rejects.toMatchObject(ALREADY_IN_USE);
      expect(w.pool(address).entry).toBe(chips(100));
    });

    it('rejects a bad split', async () => {
      const base = { kind: 0, game: 'cube', periodStart: w.now(), periodEnd: w.now() + WEEK, entry: chips(100) };
      await expect(w.op.createPool(await w.next(), { ...base, splitBps: [5000, 3000, 2001], winners: 3 })).rejects.toMatchObject(code('BadSplit'));
      await expect(w.op.createPool(await w.next(), { ...base, splitBps: [2000, 2000, 2000, 2000, 2000], winners: 6 })).rejects.toMatchObject(code('BadSplit'));
      await expect(w.op.createPool(await w.next(), { ...base, splitBps: [5000, 3000, 2000], winners: 2 })).rejects.toMatchObject(code('BadSplit'));
      await expect(w.op.createPool(await w.next(), { ...base, splitBps: [5000], winners: 0 })).rejects.toMatchObject(code('BadSplit'));
      await expect(w.op.createPool(await w.next(), { ...base, splitBps: [5000], winners: 1, kind: 1, periodEnd: base.periodStart })).rejects.toMatchObject(code('InvalidParam'));
      expect(w.config().opSeq).toBe(0n);
    });

    it('enter_pool moves the entry from the player into the pool and keeps the vault invariant', async () => {
      const pool = await w.createPool();
      const p = await w.player({ deposit: 250 });
      const before = w.config();
      await w.op.enterPool(await w.next(), pool, p.wallet);
      expect(w.conn.lastLogs.some((l) => l.includes('podium:enter_pool'))).toBe(true);
      expect(w.playerAcc(p.wallet).available).toBe(chips(150));
      expect(w.pool(pool)).toMatchObject({ total: chips(100), entries: 1, lockedPart: 0n });
      const after = w.config();
      expect(after.totalPlayerBalance).toBe(before.totalPlayerBalance - chips(100));
      expect(after.totalEscrow).toBe(before.totalEscrow + chips(100));
      expect(w.vaultBalance()).toBe(chips(250));
      w.checkInvariant();

      await w.op.enterPool(await w.next(), pool, p.wallet);
      await expect(w.op.enterPool(await w.next(), pool, p.wallet)).rejects.toMatchObject(code('InsufficientBalance'));
      expect(w.playerAcc(p.wallet).available).toBe(chips(50));
      expect(w.pool(pool)).toMatchObject({ total: chips(200), entries: 2 });
    });

    /** A weekly pool with `n` entrants at 100 chips; returns the entrants in entry order. */
    async function filledPool(n: number, over: Parameters<World['createPool']>[0] = {}) {
      const pool = await w.createPool(over);
      const players: TestPlayer[] = [];
      for (let i = 0; i < n; i++) {
        const p = await w.player({ deposit: 1000 });
        await w.op.enterPool(await w.next(), pool, p.wallet);
        players.push(p);
      }
      return { pool, players };
    }

    it('close_pool pays 50/30/20 after the 6% fee exactly as splitPool() computes', async () => {
      const { pool, players } = await filledPool(7);
      const totalChips = 7 * ECONOMY.rankedEntry;
      const expected = splitPool(totalChips, ECONOMY.weeklySplit, 3);
      expect(expected).toEqual({ fee: 42, payouts: [329, 197, 132] });
      w.warp(WEEK);
      await w.op.closePool(
        await w.next(),
        pool,
        expected.payouts.map((chipsWon, i) => ({ wallet: players[i]!.wallet, payout: chips(chipsWon) })),
      );
      expected.payouts.forEach((chipsWon, i) => {
        expect(w.playerAcc(players[i]!.wallet)).toMatchObject({ available: chips(900 + chipsWon), locked: 0n });
      });
      for (const loser of players.slice(3)) expect(w.playerAcc(loser.wallet).available).toBe(chips(900));
      const c = w.config();
      expect(c.treasuryBalance).toBe(chips(expected.fee));
      expect(c.totalEscrow).toBe(0n);
      expect(w.pool(pool)).toMatchObject({ closed: true, total: chips(totalChips) });
      const events = parsePodiumLogs(w.conn.lastLogs);
      expect(events.filter((e) => e.event === 'pool_payout')).toHaveLength(3);
      expect(events.at(-1)).toMatchObject({ event: 'close_pool', fields: { total: String(chips(700)), paid: String(chips(658)), fee: String(chips(42)) } });
    });

    it('pays the cup split to five winners', async () => {
      const { pool, players } = await filledPool(6, { kind: 1, game: 'breaker', entry: chips(ECONOMY.cupEntry), splitBps: splitToBps(ECONOMY.cupSplit), winners: 5 });
      const expected = splitPool(6 * ECONOMY.cupEntry, ECONOMY.cupSplit, 5);
      w.warp(WEEK);
      await w.op.closePool(await w.next(), pool, expected.payouts.map((c, i) => ({ wallet: players[i]!.wallet, payout: chips(c) })));
      expected.payouts.forEach((c, i) => expect(w.playerAcc(players[i]!.wallet).available).toBe(chips(750 + c)));
      expect(w.config().treasuryBalance).toBe(chips(expected.fee));
      expect(w.conn.lastUnits).toBeLessThan(200_000n);
    });

    it('rejects a payout above the split cap', async () => {
      const { pool, players } = await filledPool(7);
      w.warp(WEEK);
      const pay = (amounts: bigint[]) => amounts.map((payout, i) => ({ wallet: players[i]!.wallet, payout }));
      // First place may get floor(658 * 50%) = 329 chips plus one unit of rounding tolerance.
      await expect(w.op.closePool(await w.next(), pool, pay([chips(329) + UNIT + 1n]))).rejects.toMatchObject(code('PayoutTooHigh'));
      // Second place cannot take first place's share.
      await expect(w.op.closePool(await w.next(), pool, pay([0n, chips(329)]))).rejects.toMatchObject(code('PayoutTooHigh'));
      // Every place at its cap plus the tolerance is more than the pot allows in total.
      await expect(
        w.op.closePool(await w.next(), pool, pay([chips(329) + UNIT, 197_400_000n + UNIT, 131_600_000n + UNIT])),
      ).rejects.toMatchObject(code('PayoutTooHigh'));
      // More payouts than places.
      await expect(w.op.closePool(await w.next(), pool, pay([1n, 1n, 1n, 1n]))).rejects.toMatchObject(code('PayoutTooHigh'));
      // The same player in two places.
      await expect(
        w.op.closePool(await w.next(), pool, [
          { wallet: players[0]!.wallet, payout: chips(100) },
          { wallet: players[0]!.wallet, payout: chips(100) },
        ]),
      ).rejects.toMatchObject(code('BadWinners'));
      // A payout count that does not match the accounts.
      const ix = buildClosePoolIx(w.operatorKp.publicKey, await w.next(), pool, [players[0]!.wallet], [chips(1)], w.programId);
      ix.keys.pop();
      await expect(w.send([ix], [w.operatorKp])).rejects.toMatchObject(code('BadWinners'));
      // An account that is not a Player (the pool itself) cannot be paid.
      const bad = buildClosePoolIx(w.operatorKp.publicKey, await w.next(), pool, [players[0]!.wallet], [chips(1)], w.programId);
      bad.keys[3]!.pubkey = pool;
      await expect(w.send([bad], [w.operatorKp])).rejects.toMatchObject(NOT_THAT_ACCOUNT_TYPE);
      expect(w.pool(pool).closed).toBe(false);
      expect(w.config().treasuryBalance).toBe(0n);
    });

    it('rejects closing before period_end, and a second close', async () => {
      const { pool, players } = await filledPool(3);
      const winners = [{ wallet: players[0]!.wallet, payout: chips(141) }];
      await expect(w.op.closePool(await w.next(), pool, winners)).rejects.toMatchObject(code('PoolNotEnded'));
      w.warp(WEEK - 1n);
      await expect(w.op.closePool(await w.next(), pool, winners)).rejects.toMatchObject(code('PoolNotEnded'));
      w.warp(1n);
      await w.op.closePool(await w.next(), pool, winners);
      await expect(w.op.closePool(await w.next(), pool, winners)).rejects.toMatchObject(code('PoolClosed'));
      await expect(w.op.closePool(await w.next(), pool, [])).rejects.toMatchObject(code('PoolClosed'));
      await expect(w.op.enterPool(await w.next(), pool, players[1]!.wallet)).rejects.toMatchObject(code('PoolClosed'));
      expect(w.playerAcc(players[0]!.wallet).available).toBe(chips(900 + 141));
    });

    it('with fewer winners than places the rest goes to the treasury', async () => {
      const { pool, players } = await filledPool(3);
      const expected = splitPool(300, ECONOMY.weeklySplit, 1);
      expect(expected).toEqual({ fee: 18, payouts: [141] });
      w.warp(WEEK);
      await w.op.closePool(await w.next(), pool, [{ wallet: players[0]!.wallet, payout: chips(141) }]);
      expect(w.playerAcc(players[0]!.wallet).available).toBe(chips(900 + 141));
      // Fee 18 plus the unclaimed second and third shares (85 + 56).
      expect(w.config().treasuryBalance).toBe(chips(300 - 141));
      expect(w.config().totalEscrow).toBe(0n);
    });

    it('an empty pool closes with no payouts, and cannot pay anyone', async () => {
      const pool = await w.createPool();
      const p = await w.player({ deposit: 100 });
      w.warp(WEEK);
      await expect(w.op.closePool(await w.next(), pool, [{ wallet: p.wallet, payout: 1n }])).rejects.toMatchObject(code('PayoutTooHigh'));
      await w.op.closePool(await w.next(), pool, []);
      expect(w.pool(pool).closed).toBe(true);
      expect(w.config().treasuryBalance).toBe(0n);
    });

    it('a pool cannot pay out of another pool or out of player balances', async () => {
      const a = await filledPool(1, { game: 'blaster' });
      await filledPool(5, { game: 'hopper' });
      w.warp(WEEK);
      // Pool A holds 100; nothing above its own after-fee pot can leave it.
      await expect(w.op.closePool(await w.next(), a.pool, [{ wallet: a.players[0]!.wallet, payout: chips(100) }])).rejects.toMatchObject(code('PayoutTooHigh'));
      await w.op.closePool(await w.next(), a.pool, [{ wallet: a.players[0]!.wallet, payout: chips(47) }]);
      expect(w.config().totalEscrow).toBe(chips(500));
    });
  });

  // ------------------------------------------------------------------ duels

  describe('duels', () => {
    const ID = '3f2b8c1e-9d4a-4b7e-8f01-23456789abcd';
    const ID2 = '00000000-0000-4000-8000-000000000002';

    it('open, join, settle: the winner gets stake * 2 * 0.94 and 6% goes to the treasury', async () => {
      const a = await w.player({ deposit: 500 });
      const b = await w.player({ deposit: 500 });
      await w.openDuel(ID, a, 100);
      expect(w.playerAcc(a.wallet).available).toBe(chips(400));
      expect(await fetchDuel(w.conn, ID, w.programId)).toMatchObject({ state: 0, stake: chips(100), joiner: null, feeBps: 600, createdAt: T0 });
      expect(w.config().totalEscrow).toBe(chips(100));

      await w.op.duelJoin(await w.next(), ID, b.wallet);
      expect(w.playerAcc(b.wallet).available).toBe(chips(400));
      expect(w.duel(ID).state).toBe(1);
      expect(w.duel(ID).joiner!.equals(b.wallet)).toBe(true);
      expect(w.config().totalEscrow).toBe(chips(200));

      expect(duelPayout(100)).toBe(188);
      await w.op.duelSettle(await w.next(), ID, b.wallet, chips(duelPayout(100)));
      expect(w.playerAcc(b.wallet).available).toBe(chips(400 + 188));
      expect(w.playerAcc(a.wallet).available).toBe(chips(400));
      expect(w.config()).toMatchObject({ treasuryBalance: chips(duelFee(100)), totalEscrow: 0n });
      expect(w.config().treasuryBalance).toBe((chips(200) * FEE_BPS) / 10_000n);
      expect(w.duel(ID).state).toBe(2);
      await expect(w.op.duelSettle(await w.next(), ID, b.wallet, chips(188))).rejects.toMatchObject(code('BadDuelState'));
      await expect(w.op.duelRefund(await w.next(), ID)).rejects.toMatchObject(code('BadDuelState'));
    });

    it('rejects a payout above the pot minus the fee, and a winner who is not in the duel', async () => {
      const a = await w.player({ deposit: 500 });
      const b = await w.player({ deposit: 500 });
      const outsider = await w.player({ deposit: 0 });
      await w.openDuel(ID, a, 100);
      await w.op.duelJoin(await w.next(), ID, b.wallet);
      await expect(w.op.duelSettle(await w.next(), ID, a.wallet, chips(188) + UNIT + 1n)).rejects.toMatchObject(code('PayoutTooHigh'));
      await expect(w.op.duelSettle(await w.next(), ID, a.wallet, chips(200))).rejects.toMatchObject(code('PayoutTooHigh'));
      await expect(w.op.duelSettle(await w.next(), ID, outsider.wallet, chips(188))).rejects.toMatchObject(code('BadDuelWinner'));
      // "No winner" cannot carry a payout.
      await expect(w.op.duelSettle(await w.next(), ID, null, chips(188))).rejects.toMatchObject(code('PayoutTooHigh'));
      await w.op.duelSettle(await w.next(), ID, a.wallet, chips(188));
      expect(w.playerAcc(a.wallet).available).toBe(chips(588));
    });

    it('join rules: not yourself, not twice, not after expiry, and you need the stake', async () => {
      const a = await w.player({ deposit: 500 });
      const b = await w.player({ deposit: 500 });
      const poor = await w.player({ deposit: 50 });
      await expect(w.op.duelOpen(await w.next(), { id: ID, creator: poor.wallet, stake: chips(100), expiresAt: w.now() + 60n })).rejects.toMatchObject(code('InsufficientBalance'));
      await expect(w.op.duelOpen(await w.next(), { id: ID, creator: a.wallet, stake: chips(100), expiresAt: w.now() })).rejects.toMatchObject(code('InvalidParam'));
      await w.openDuel(ID, a, 100);
      await expect(w.op.duelJoin(await w.next(), ID, a.wallet)).rejects.toMatchObject(code('BadDuelState'));
      await expect(w.op.duelJoin(await w.next(), ID, poor.wallet)).rejects.toMatchObject(code('InsufficientBalance'));
      await w.op.duelJoin(await w.next(), ID, b.wallet);
      await expect(w.op.duelJoin(await w.next(), ID, poor.wallet)).rejects.toMatchObject(code('BadDuelState'));
      await w.openDuel(ID2, a, 100);
      w.warp(24n * 3600n);
      await expect(w.op.duelJoin(await w.next(), ID2, b.wallet)).rejects.toMatchObject(code('DuelExpired'));
      await w.op.duelRefund(await w.next(), ID2);
      await w.op.duelSettle(await w.next(), ID, null, 0);
    });

    it('refund returns the stake to the creator of an open duel, even while paused', async () => {
      const a = await w.player({ deposit: 500 });
      const b = await w.player({ deposit: 500 });
      await w.openDuel(ID, a, 250);
      await w.send([buildSetPausedIx(w.admin.publicKey, true, w.programId)], [w.admin]);
      await w.op.duelRefund(await w.next(), ID);
      await w.send([buildSetPausedIx(w.admin.publicKey, false, w.programId)], [w.admin]);
      expect(w.playerAcc(a.wallet)).toMatchObject({ available: chips(500), locked: 0n });
      expect(w.duel(ID).state).toBe(3);
      expect(w.config()).toMatchObject({ totalEscrow: 0n, treasuryBalance: 0n });
      await expect(w.op.duelRefund(await w.next(), ID)).rejects.toMatchObject(code('BadDuelState'));
      await expect(w.op.duelJoin(await w.next(), ID, b.wallet)).rejects.toMatchObject(code('BadDuelState'));
      // A matched duel cannot be refunded, and the refund cannot go to someone else.
      await w.openDuel(ID2, a, 100);
      await expect(w.op.duelRefund(await w.next(), ID2, b.wallet)).rejects.toMatchObject(code('BadAccount'));
      await w.op.duelJoin(await w.next(), ID2, b.wallet);
      await expect(w.op.duelRefund(await w.next(), ID2)).rejects.toMatchObject(code('BadDuelState'));
      await w.op.duelSettle(await w.next(), ID2, a.wallet, chips(188));
    });

    it('forfeit: with no winner the whole pot goes to the treasury', async () => {
      const a = await w.player({ deposit: 500 });
      const b = await w.player({ deposit: 500 });
      // Open duel, creator forfeits: pot = one stake.
      await w.openDuel(ID, a, 100);
      await expect(w.op.duelSettle(await w.next(), ID, a.wallet, chips(94))).rejects.toMatchObject(code('BadDuelState'));
      await w.op.duelSettle(await w.next(), ID, null, 0);
      expect(w.config()).toMatchObject({ treasuryBalance: chips(100), totalEscrow: 0n });
      expect(w.duel(ID).state).toBe(2);
      // Matched duel, both forfeit: pot = two stakes.
      await w.openDuel(ID2, a, 50);
      await w.op.duelJoin(await w.next(), ID2, b.wallet);
      await w.send([buildDuelSettleIx(w.operatorKp.publicKey, await w.next(), ID2, null, 0, w.programId)], [w.operatorKp]);
      expect(w.config()).toMatchObject({ treasuryBalance: chips(200), totalEscrow: 0n });
      expect(w.playerAcc(a.wallet).available).toBe(chips(350));
      expect(w.playerAcc(b.wallet).available).toBe(chips(450));
    });
  });

  // ------------------------------------------------------------------ shop

  describe('spend', () => {
    it('burns exactly 10% from the vault and sends the rest to the treasury', async () => {
      const p = await w.player({ deposit: 1000 });
      const supply = w.supply();
      const price = chips(ECONOMY.boxPrice);
      const burn = (price * 1000n) / 10_000n;
      expect(burn).toBe(chips(30));
      await w.op.spend(await w.next(), p.wallet, price, burn);
      expect(w.supply()).toBe(supply - burn);
      expect(w.vaultBalance()).toBe(chips(1000) - burn);
      expect(w.playerAcc(p.wallet).available).toBe(chips(700));
      expect(w.config()).toMatchObject({ treasuryBalance: price - burn, totalBurned: burn, totalPlayerBalance: chips(700) });
      expect(parsePodiumLogs(w.conn.lastLogs)[0]).toMatchObject({ event: 'spend', fields: { amount: String(price), burned: String(burn) } });
    });

    it('rejects a burn above burn_bps, and a spend above the balance', async () => {
      const p = await w.player({ deposit: 1000 });
      const supply = w.supply();
      await expect(w.op.spend(await w.next(), p.wallet, chips(300), chips(30) + UNIT + 1n)).rejects.toMatchObject(code('BurnTooHigh'));
      await expect(w.op.spend(await w.next(), p.wallet, 10n, 11n)).rejects.toMatchObject(code('BurnTooHigh'));
      await expect(w.op.spend(await w.next(), p.wallet, chips(1001), chips(100))).rejects.toMatchObject(code('InsufficientBalance'));
      await expect(w.op.spend(await w.next(), p.wallet, 0, 0)).rejects.toMatchObject(code('InvalidAmount'));
      expect(w.supply()).toBe(supply);
      expect(w.config().totalBurned).toBe(0n);
    });
  });

  // ------------------------------------------------------------------ rewards and vesting

  describe('rewards and vesting', () => {
    const fund = (amountChips: number) =>
      w.mintTo(w.adminAta, chips(amountChips)).then(() =>
        w.send([buildFundRewardsIx(w.admin.publicKey, w.adminAta, chips(amountChips), w.programId)], [w.admin]),
      );

    it('credit_reward fails when the rewards pot is empty: rewards are never minted', async () => {
      const p = await w.player({ deposit: 100 });
      await expect(w.op.creditReward(await w.next(), p.wallet, chips(150))).rejects.toMatchObject(code('InsufficientRewards'));
      await fund(100);
      expect(w.config().rewardsBalance).toBe(chips(100));
      await expect(w.op.creditReward(await w.next(), p.wallet, chips(100) + 1n)).rejects.toMatchObject(code('InsufficientRewards'));
      const supply = w.supply();
      await w.op.creditReward(await w.next(), p.wallet, chips(100));
      expect(w.supply()).toBe(supply);
      expect(w.config().rewardsBalance).toBe(0n);
      await expect(w.op.creditReward(await w.next(), p.wallet, 1)).rejects.toMatchObject(code('InsufficientRewards'));
    });

    it('reward tokens are usable in games at once, withdrawable only after the delay', async () => {
      await fund(10_000);
      const p = await w.player({ tokens: 0 });
      await w.op.creditReward(await w.next(), p.wallet, chips(300));
      const acc = w.playerAcc(p.wallet);
      expect(acc).toMatchObject({ available: 0n, locked: chips(300), unlockAt: T0 + VEST });
      expect(matured(acc, w.now())).toBe(0n);

      // Usable at once: enters a pool with locked tokens.
      const pool = await w.createPool({ periodEnd: w.now() + 30n * 24n * 3600n });
      await w.op.enterPool(await w.next(), pool, p.wallet);
      expect(w.playerAcc(p.wallet)).toMatchObject({ available: 0n, locked: chips(200) });
      expect(w.pool(pool)).toMatchObject({ total: chips(100), lockedPart: chips(100) });

      // Not withdrawable before unlock_at.
      await expect(withdraw(p, chips(1))).rejects.toMatchObject(code('InsufficientBalance'));
      w.warp(VEST - 1n);
      await expect(withdraw(p, chips(1))).rejects.toMatchObject(code('InsufficientBalance'));

      // Withdrawable after.
      w.warp(1n);
      expect(matured(w.playerAcc(p.wallet), w.now())).toBe(chips(200));
      await withdraw(p, chips(200));
      expect(w.tokenBalance(p.ata)).toBe(chips(200));
      expect(w.playerAcc(p.wallet)).toMatchObject({ available: 0n, locked: 0n });
    });

    it('spending draws from available first, then locked', async () => {
      await fund(1000);
      const p = await w.player({ deposit: 150 });
      await w.op.creditReward(await w.next(), p.wallet, chips(200));
      await w.op.spend(await w.next(), p.wallet, chips(100), chips(10));
      expect(w.playerAcc(p.wallet)).toMatchObject({ available: chips(50), locked: chips(200) });
      await w.op.spend(await w.next(), p.wallet, chips(100), chips(10));
      expect(w.playerAcc(p.wallet)).toMatchObject({ available: 0n, locked: chips(150) });
      await expect(w.op.spend(await w.next(), p.wallet, chips(151), 0)).rejects.toMatchObject(code('InsufficientBalance'));
      await expect(withdraw(p, 1n)).rejects.toMatchObject(code('InsufficientBalance'));
    });

    it('a later reward pushes unlock_at out; the delay change applies to new rewards only', async () => {
      await fund(1000);
      const p = await w.player({ tokens: 0 });
      await w.op.creditReward(await w.next(), p.wallet, chips(100));
      w.warp(1000n);
      await w.op.creditReward(await w.next(), p.wallet, chips(100));
      expect(w.playerAcc(p.wallet)).toMatchObject({ locked: chips(200), unlockAt: T0 + 1000n + VEST });
      // Shortening the delay does not pull an existing unlock time forward.
      await w.send([buildSetVestSecondsIx(w.admin.publicKey, 10, w.programId)], [w.admin]);
      await w.op.creditReward(await w.next(), p.wallet, chips(100));
      expect(w.playerAcc(p.wallet)).toMatchObject({ locked: chips(300), unlockAt: T0 + 1000n + VEST });
    });

    it('the locked share carries over through a pool payout', async () => {
      await fund(1000);
      const rewarded = await w.player({ tokens: 0 });
      const b = await w.player({ deposit: 100 });
      const c = await w.player({ deposit: 100 });
      await w.op.creditReward(await w.next(), rewarded.wallet, chips(100));
      const pool = await w.createPool();
      for (const p of [rewarded, b, c]) await w.op.enterPool(await w.next(), pool, p.wallet);
      expect(w.pool(pool)).toMatchObject({ total: chips(300), lockedPart: chips(100) });

      w.warp(WEEK);
      const { payouts } = splitPool(300, ECONOMY.weeklySplit, 3);
      await w.op.closePool(await w.next(), pool, [b, c, rewarded].map((p, i) => ({ wallet: p.wallet, payout: chips(payouts[i]!) })));
      // One third of the pool was locked reward tokens, so one third of each prize stays locked.
      const closeTime = w.now();
      for (const [i, p] of [b, c, rewarded].entries()) {
        const prize = chips(payouts[i]!);
        const lockedShare = (prize * chips(100)) / chips(300);
        expect(w.playerAcc(p.wallet)).toMatchObject({ available: prize - lockedShare, locked: lockedShare, unlockAt: closeTime + VEST });
      }
      // The winner cannot withdraw the locked third until it vests.
      const first = chips(payouts[0]!);
      await expect(withdraw(b, first)).rejects.toMatchObject(code('InsufficientBalance'));
      await withdraw(b, first - first / 3n);
      w.warp(VEST);
      await withdraw(b, first / 3n);
      expect(w.playerAcc(b.wallet)).toMatchObject({ available: 0n, locked: 0n });
    });

    it('the locked share carries over through a duel, and a refund returns locked as locked', async () => {
      await fund(1000);
      const rewarded = await w.player({ tokens: 0 });
      const friend = await w.player({ deposit: 100 });
      await w.op.creditReward(await w.next(), rewarded.wallet, chips(100));
      const unlockAt = w.playerAcc(rewarded.wallet).unlockAt;

      // Refund: the locked stake comes back locked, under the same unlock time.
      await w.openDuel('00000000-0000-4000-8000-0000000000aa', rewarded, 100);
      expect(w.playerAcc(rewarded.wallet)).toMatchObject({ available: 0n, locked: 0n });
      w.warp(500n);
      await w.op.duelRefund(await w.next(), '00000000-0000-4000-8000-0000000000aa');
      expect(w.playerAcc(rewarded.wallet)).toMatchObject({ available: 0n, locked: chips(100), unlockAt });
      await expect(withdraw(rewarded, 1n)).rejects.toMatchObject(code('InsufficientBalance'));

      // Losing on purpose to a friend does not unlock the tokens: half the pot was locked.
      const id = '00000000-0000-4000-8000-0000000000bb';
      await w.openDuel(id, rewarded, 100);
      await w.op.duelJoin(await w.next(), id, friend.wallet);
      expect(w.duel(id).lockedPart).toBe(chips(100));
      await w.op.duelSettle(await w.next(), id, friend.wallet, chips(188));
      expect(w.playerAcc(friend.wallet)).toMatchObject({ available: chips(94), locked: chips(94), unlockAt: w.now() + VEST });
      await expect(withdraw(friend, chips(95))).rejects.toMatchObject(code('InsufficientBalance'));
    });

    it('fees fund rewards through the treasury, and the admin can withdraw fees to the treasury wallet only', async () => {
      const a = await w.player({ deposit: 500 });
      await w.op.spend(await w.next(), a.wallet, chips(300), chips(30));
      expect(w.config().treasuryBalance).toBe(chips(270));
      await w.send([buildTreasuryToRewardsIx(w.admin.publicKey, chips(200), w.programId)], [w.admin]);
      expect(w.config()).toMatchObject({ treasuryBalance: chips(70), rewardsBalance: chips(200) });
      await expect(w.send([buildTreasuryToRewardsIx(w.admin.publicKey, chips(70) + 1n, w.programId)], [w.admin])).rejects.toMatchObject(code('InsufficientTreasury'));
      await expect(w.send([buildTreasuryWithdrawIx(w.admin.publicKey, w.treasuryWallet, chips(70) + 1n, w.programId)], [w.admin])).rejects.toMatchObject(code('InsufficientTreasury'));
      // Not to any other token account.
      await expect(w.send([buildTreasuryWithdrawIx(w.admin.publicKey, w.adminAta, chips(70), w.programId)], [w.admin])).rejects.toMatchObject(code('BadAccount'));
      await w.send([buildTreasuryWithdrawIx(w.admin.publicKey, w.treasuryWallet, chips(70), w.programId)], [w.admin]);
      expect(w.tokenBalance(w.treasuryWallet)).toBe(chips(70));
      expect(w.config().treasuryBalance).toBe(0n);
      expect(w.vaultBalance()).toBe(chips(500 - 30 - 70));
      await w.op.creditReward(await w.next(), a.wallet, chips(200));
      expect(w.config().rewardsBalance).toBe(0n);
    });

    it('tokens sent straight to the vault are not credited to anyone', async () => {
      const p = await w.player({ tokens: 100, deposit: 50 });
      await w.send([createTransferInstruction(p.ata, vaultPda(w.programId), p.wallet, chips(50))], [p.kp]);
      expect(w.vaultBalance()).toBe(chips(100));
      expect(w.playerAcc(p.wallet).available).toBe(chips(50));
      await expect(withdraw(p, chips(51))).rejects.toMatchObject(code('InsufficientBalance'));
      await withdraw(p, chips(50));
      // The surplus stays in the vault, owned by no balance.
      expect(w.vaultBalance()).toBe(chips(50));
      w.surplus = chips(50);
    });
  });

  // ------------------------------------------------------------------ sequence and operator

  describe('operation sequence and the Operator class', () => {
    it('BadSequence on a replayed or skipped seq', async () => {
      const p = await w.player({ deposit: 500 });
      const pool = await w.createPool(); // seq 1
      const enter = (seq: bigint) => w.send([buildEnterPoolIx(w.operatorKp.publicKey, seq, pool, p.wallet, w.programId)], [w.operatorKp]);
      await enter(2n);
      await expect(enter(2n)).rejects.toMatchObject(code('BadSequence')); // replay
      await expect(enter(1n)).rejects.toMatchObject(code('BadSequence')); // old
      await expect(enter(0n)).rejects.toMatchObject(code('BadSequence'));
      await expect(enter(4n)).rejects.toMatchObject(code('BadSequence')); // skipped 3
      await expect(enter(0xffff_ffff_ffff_ffffn)).rejects.toMatchObject(code('BadSequence'));
      expect(w.config().opSeq).toBe(2n);
      expect(w.pool(pool).entries).toBe(1);
      await enter(3n);
      expect(w.config().opSeq).toBe(3n);
      expect(w.playerAcc(p.wallet).available).toBe(chips(300));
    });

    it('a failed operation does not use its sequence number', async () => {
      const p = await w.player({ deposit: 50 });
      const pool = await w.createPool();
      await expect(w.op.enterPool(2, pool, p.wallet)).rejects.toMatchObject(code('InsufficientBalance'));
      expect(await w.op.opSeq()).toBe(1n);
      await w.op.setFrozen(2, p.wallet, true);
      expect(await w.op.opSeq()).toBe(2n);
    });

    it('the Operator treats an already-applied seq as success and sends nothing', async () => {
      const p = await w.player({ deposit: 500 });
      const pool = await w.createPool(); // seq 1
      const first = await w.op.enterPool(2, pool, p.wallet);
      expect(first).toMatchObject({ seq: 2n, applied: true, signature: expect.any(String) });
      const sent = w.conn.sent;
      const retry = await w.op.enterPool(2, pool, p.wallet);
      expect(retry).toEqual({ seq: 2n, applied: false, signature: null });
      expect(await w.op.creditReward(1, p.wallet, chips(5))).toMatchObject({ applied: false });
      expect(w.conn.sent).toBe(sent);
      expect(w.pool(pool).entries).toBe(1);
      expect(w.playerAcc(p.wallet).available).toBe(chips(400));
    });

    it('the Operator refuses a seq that is ahead of the chain', async () => {
      const p = await w.player({ deposit: 500 });
      await expect(w.op.setFrozen(5, p.wallet, true)).rejects.toBeInstanceOf(SequenceGapError);
      expect(w.config().opSeq).toBe(0n);
    });

    it('a retry after a lost confirmation does not apply the operation twice', async () => {
      const p = await w.player({ deposit: 500 });
      const pool = await w.createPool();
      w.conn.dropConfirmations = 1;
      // The transaction landed but the confirmation was lost: the call reports "already applied".
      expect(await w.op.enterPool(2, pool, p.wallet)).toEqual({ seq: 2n, applied: false, signature: null });
      expect(await w.op.enterPool(2, pool, p.wallet)).toEqual({ seq: 2n, applied: false, signature: null });
      expect(w.pool(pool).entries).toBe(1);
      expect(w.config().opSeq).toBe(2n);
    });

    it('two Operator instances racing for one seq apply exactly one operation', async () => {
      const p = await w.player({ deposit: 500 });
      const pool = await w.createPool();
      const other = new Operator(w.conn, w.operatorKp, { programId: w.programId });
      const results = await Promise.all([w.op.enterPool(2, pool, p.wallet), other.enterPool(2, pool, p.wallet)]);
      expect(results.filter((r) => r.applied)).toHaveLength(1);
      expect(w.pool(pool).entries).toBe(1);
    });

    it('concurrent calls on one Operator are applied in order', async () => {
      const p = await w.player({ deposit: 500 });
      const pool = await w.createPool();
      const results = await Promise.all([2, 3, 4].map((seq) => w.op.enterPool(seq, pool, p.wallet)));
      expect(results.every((r) => r.applied)).toBe(true);
      expect(w.pool(pool).entries).toBe(3);
    });

    it('non-operator signers are rejected by every operator instruction', async () => {
      const mallory = Keypair.generate();
      w.svm.airdrop(mallory.publicKey, 10_000_000_000n);
      const a = await w.player({ deposit: 500 });
      const b = await w.player({ deposit: 500 });
      const pool = await w.createPool();
      await w.op.enterPool(await w.next(), pool, a.wallet);
      const id = '00000000-0000-4000-8000-000000000001';
      const id2 = '00000000-0000-4000-8000-000000000002';
      await w.openDuel(id, a, 100);
      await w.op.duelJoin(await w.next(), id, b.wallet);
      await w.openDuel(id2, a, 100);
      w.warp(WEEK);
      const before = w.config();

      const evil = new Operator(w.conn, mallory, { programId: w.programId });
      const seq = before.opSeq + 1n;
      const attempts: Promise<unknown>[] = [
        evil.createPool(seq, { kind: 1, game: 'cube', periodStart: 1, periodEnd: 2, entry: 1, splitBps: [10_000], winners: 1 }),
        evil.enterPool(seq, pool, b.wallet),
        evil.closePool(seq, pool, [{ wallet: a.wallet, payout: chips(47) }]),
        evil.duelOpen(seq, { id: '00000000-0000-4000-8000-000000000003', creator: a.wallet, stake: 1, expiresAt: w.now() + 60n }),
        evil.duelJoin(seq, id2, b.wallet),
        evil.duelSettle(seq, id, b.wallet, chips(188)),
        evil.duelSettle(seq, id, null, 0),
        evil.duelRefund(seq, id2),
        evil.spend(seq, a.wallet, chips(100), chips(10)),
        evil.creditReward(seq, a.wallet, 1),
        evil.setFrozen(seq, a.wallet, true),
      ];
      for (const attempt of attempts) await expect(attempt).rejects.toMatchObject(code('Unauthorized'));
      // A player cannot act as operator on their own account, and the admin is not the operator.
      await expect(w.send([buildCreditRewardIx(a.wallet, seq, a.wallet, 1, w.programId)], [a.kp])).rejects.toMatchObject(code('Unauthorized'));
      await expect(w.send([buildSetFrozenIx(w.admin.publicKey, seq, a.wallet, true, w.programId)], [w.admin])).rejects.toMatchObject(code('Unauthorized'));
      // The operator's account without its signature is not enough.
      const unsigned = buildCreditRewardIx(w.operatorKp.publicKey, seq, a.wallet, 1, w.programId);
      unsigned.keys[0]!.isSigner = false;
      await expect(w.send([unsigned], [mallory])).rejects.toThrow(/AccountNotSigner|3010/);
      expect(w.config()).toEqual(before);
    });
  });

  // ------------------------------------------------------------------ withdraw co-signing

  describe('coSignWithdraw', () => {
    async function playerSigned(p: TestPlayer, amount: bigint, mutate?: (tx: Transaction) => void, sign = true): Promise<Buffer> {
      const tx = buildWithdrawTx({
        wallet: p.wallet, mint: w.mint, amount, operator: w.operatorKp.publicKey, recentBlockhash: w.svm.latestBlockhash(), programId: w.programId,
      });
      mutate?.(tx);
      if (sign) tx.partialSign(p.kp);
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    }

    it('co-signs the expected withdrawal and it lands', async () => {
      const p = await w.player({ deposit: 500 });
      const raw = await playerSigned(p, chips(120));
      const sig = await w.op.submitWithdraw(raw.toString('base64'), { wallet: p.wallet, amount: chips(120) });
      expect(sig).toEqual(expect.any(String));
      expect(w.tokenBalance(p.ata)).toBe(chips(120));
      expect(w.playerAcc(p.wallet).available).toBe(chips(380));
    });

    it('refuses anything that is not exactly the expected withdrawal', async () => {
      const p = await w.player({ deposit: 500 });
      const other = await w.player({ deposit: 500 });
      const expected = { wallet: p.wallet, amount: chips(120) };
      const refuse = async (raw: Buffer, exp = expected) => {
        await expect(w.op.coSignWithdraw(raw, exp)).rejects.toBeInstanceOf(WithdrawCheckError);
      };
      // A different amount than the server approved.
      await refuse(await playerSigned(p, chips(121)));
      // A different player than the session's.
      await refuse(await playerSigned(other, chips(120)));
      // A destination that is not the player's own token account.
      await refuse(await playerSigned(p, chips(120), (tx) => (tx.instructions[0]!.keys[5]!.pubkey = other.ata)));
      // An extra instruction, before or after (here: a SOL transfer out of the operator).
      const steal = SystemProgram.transfer({ fromPubkey: w.operatorKp.publicKey, toPubkey: p.wallet, lamports: 1_000_000_000 });
      await refuse(await playerSigned(p, chips(120), (tx) => tx.add(steal)));
      await refuse(await playerSigned(p, chips(120), (tx) => tx.instructions.unshift(createAssociatedTokenAccountIdempotentInstruction(p.wallet, p.ata, p.wallet, w.mint))));
      // Two withdrawals in one transaction.
      await refuse(await playerSigned(p, chips(120), (tx) => tx.add(buildWithdrawIx(p.wallet, w.operatorKp.publicKey, p.ata, chips(120), w.programId))));
      // Another program with the same data and accounts.
      await refuse(
        await playerSigned(p, chips(120), (tx) => {
          const ix = tx.instructions[0]!;
          tx.instructions[0] = new TransactionInstruction({ programId: SystemProgram.programId, keys: ix.keys, data: ix.data });
        }),
      );
      // Another instruction of this program that the operator may sign (operator as fee payer and signer).
      await refuse(
        await playerSigned(p, chips(120), (tx) => {
          tx.instructions[0] = buildCreditRewardIx(w.operatorKp.publicKey, 1, p.wallet, chips(120), w.programId);
        }),
      );
      // The operator as fee payer.
      await refuse(await playerSigned(p, chips(120), (tx) => (tx.feePayer = w.operatorKp.publicKey)));
      // Not signed by the player.
      await refuse(await playerSigned(p, chips(120), undefined, false));
      // A signature that does not verify.
      const tampered = await playerSigned(p, chips(120));
      tampered[10] = tampered[10]! ^ 0xff;
      await refuse(tampered);
      // Garbage.
      await refuse(Buffer.from([1, 2, 3]));
      expect(w.tokenBalance(p.ata)).toBe(0n);
      expect(w.playerAcc(p.wallet).available).toBe(chips(500));
    });

    it('a co-signed withdrawal still fails on-chain if the balance is not there', async () => {
      const p = await w.player({ deposit: 100 });
      const raw = await playerSigned(p, chips(101));
      await expect(w.op.submitWithdraw(raw, { wallet: p.wallet, amount: chips(101) })).rejects.toMatchObject(code('InsufficientBalance'));
    });
  });
});

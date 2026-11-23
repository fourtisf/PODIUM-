// Phase 3 routes: the devnet / localnet TEST token (no value). While CHAIN_MODE is off only
// GET /chain/config answers (with mode 'off'); everything else is 404.
import { matured, TOKEN_DECIMALS } from '@podium/chain';
import type {
  ChainConfigResponse, ChainStatusResponse, DepositConfirmResponse, FaucetResponse, WithdrawPrepareResponse, WithdrawSubmitResponse,
} from '@podium/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { creditDeposit, reconcileDeposits } from '../chain/deposits';
import { faucet } from '../chain/faucet';
import { assertCountry, countryBlocked, requireValue } from '../chain/geo';
import { pendingOpsOf } from '../chain/outbox';
import type { ChainService } from '../chain/service';
import { openView, prepareWithdrawal, settleWithdrawal, submitWithdrawal } from '../chain/withdrawals';
import { notFound } from '../errors';
import { idemKey, idempotent } from '../plugins/idempotency';
import { requirePlayer, requireUser } from '../plugins/session';
import { parse } from './_util';

export default async function chainRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const on = (): ChainService => {
    if (!ctx.chain) throw notFound('Not found.');
    return ctx.chain;
  };
  /** A signed-in 18+ account with a wallet, in a country where value features are open. */
  const player = (req: FastifyRequest) => {
    on();
    const user = requirePlayer(req);
    requireValue(ctx, req, user);
    return user as typeof user & { wallet: string };
  };

  app.get('/chain/config', async (req): Promise<ChainConfigResponse> => {
    const chain = ctx.chain;
    if (!chain) {
      return { mode: 'off', cluster: null, programId: null, mint: null, unit: 1, decimals: TOKEN_DECIMALS, tokenLabel: 'tChips', faucet: false, faucetAmount: 0, vestSeconds: 0, feeBps: 0, burnBps: 0, blocked: false };
    }
    return {
      mode: chain.mode, cluster: chain.mode, programId: chain.programId.toBase58(), mint: chain.mint.toBase58(), unit: Number(chain.unit), decimals: chain.decimals,
      tokenLabel: 'tChips', faucet: !!chain.faucetKeypair, faucetAmount: chain.faucetKeypair ? chain.faucetAmount : 0,
      vestSeconds: await chain.vestSeconds(), feeBps: chain.feeBps, burnBps: chain.burnBps, blocked: countryBlocked(ctx, req),
    };
  });

  app.get('/chain/status', async (req): Promise<ChainStatusResponse> => {
    const chain = on();
    const me = requireUser(req);
    // Bring this player's open withdrawal and unreported deposits up to date first.
    for (const w of await ctx.db.withdrawal.findMany({ where: { userId: me.id, status: { in: ['prepared', 'submitted'] } }, select: { id: true } })) {
      await settleWithdrawal(ctx, w.id).catch((e) => ctx.log.warn(e, 'withdrawal check failed'));
    }
    let credited = 0;
    if (me.wallet && !me.guest && !countryBlocked(ctx, req)) credited = await reconcileDeposits(ctx, me).catch((e) => (ctx.log.warn(e, 'deposit reconcile failed'), 0));
    const u = await ctx.db.user.findUniqueOrThrow({ where: { id: me.id } });
    const open = await ctx.db.withdrawal.findFirst({ where: { userId: u.id, status: { in: ['prepared', 'submitted'] } }, orderBy: { createdAt: 'desc' } });
    const base: ChainStatusResponse = {
      wallet: u.wallet, registered: false, onchain: { available: 0, locked: 0, unlockAt: null }, withdrawable: 0, dbBalance: u.balance,
      pendingOps: await pendingOpsOf(ctx.db, u.id, u.wallet), hold: u.chainHold || u.flagged, openWithdrawal: open ? openView(open) : null, credited,
    };
    if (!u.wallet) return base;
    const p = await chain.player(u.wallet);
    if (!p) return base;
    const now = await chain.rpc.chainTime();
    const free = matured(p, now);
    const vesting = free === p.available ? p.locked : 0n;
    return {
      ...base, registered: true,
      onchain: { available: chain.toChips(free), locked: chain.toChips(vesting), unlockAt: vesting > 0n ? new Date(Number(p.unlockAt) * 1000).toISOString() : null },
      withdrawable: base.hold || p.frozen ? 0 : Math.max(0, Math.min(chain.toChips(free), u.balance)),
    };
  });

  // The wallet has already sent the deposit; this only reports its signature. The signature is the idempotency key.
  app.post('/chain/deposit/confirm', async (req): Promise<DepositConfirmResponse> => {
    const user = player(req);
    const body = parse(z.object({ signature: z.string().min(64).max(100) }), req.body);
    return creditDeposit(ctx, user, body.signature);
  });

  app.post('/chain/withdraw/prepare', async (req, reply) => {
    const chain = on();
    const user = player(req);
    const key = idemKey(req);
    const body = parse(z.object({ amount: z.number().int().min(1).max(2_000_000_000) }), req.body);
    // Outside the transaction: the destination token account must exist, and the blockhash dates the transaction.
    if (!(await ctx.db.idempotency.findUnique({ where: { key: `${user.id}:chain.withdraw.prepare:${key}` } }))) await chain.ensureTokenAccount(user.wallet);
    const bh = await chain.rpc.getLatestBlockhash('confirmed');
    return idempotent<WithdrawPrepareResponse>(ctx, reply, user.id, 'chain.withdraw.prepare', key, async (tx) => ({
      status: 200,
      body: await prepareWithdrawal(ctx, tx, user.id, body.amount, bh),
    }));
  });

  app.post('/chain/withdraw/submit', async (req): Promise<WithdrawSubmitResponse> => {
    on();
    const user = requirePlayer(req);
    assertCountry(ctx, req);
    const body = parse(z.object({ withdrawId: z.string().min(1).max(40), signedTx: z.string().min(1).max(4096).regex(/^[A-Za-z0-9+/]+={0,2}$/) }), req.body);
    return submitWithdrawal(ctx, user, body.withdrawId, body.signedTx);
  });

  // Only registered while a faucet key is configured; ChainService only exists on devnet / localnet.
  app.post('/chain/faucet', async (req): Promise<FaucetResponse> => {
    const chain = on();
    if (!chain.faucetKeypair) throw notFound('Not found.');
    const user = player(req);
    return faucet(ctx, user);
  });
}

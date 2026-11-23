// buildApp(): the Fastify application without listening or background jobs. server.ts adds those;
// tests call buildApp() directly and drive it with app.inject().
import { randomInt } from 'node:crypto';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { ChainRpc } from './chain/rpc';
import { syncRewardsPot } from './chain/outbox';
import { ChainService } from './chain/service';
import { LIMITS, loadConfig, type Config } from './config';
import type { Clock, Ctx, HttpFetch } from './ctx';
import { AppError } from './errors';
import { registerCsrf } from './plugins/csrf';
import { createDb } from './plugins/db';
import { registerRateLimits } from './plugins/ratelimit';
import { createRedis } from './plugins/redis';
import { registerSessions } from './plugins/session';
import authRoutes from './routes/auth';
import chainRoutes from './routes/chain';
import challengeRoutes from './routes/challenges';
import duelRoutes from './routes/duels';
import gameRoutes from './routes/games';
import healthRoutes from './routes/health';
import meRoutes from './routes/me';
import notificationRoutes from './routes/notifications';
import rewardRoutes from './routes/rewards';
import runRoutes from './routes/runs';
import { endRunFromStream } from './services/runs';
import { StreamService } from './services/stream';

export interface AppOptions {
  config?: Partial<Config>;
  clock?: Clock;
  /** HTTP client for Google OAuth; tests stub it. */
  http?: HttpFetch;
  /** Source of run seeds; tests fix it. */
  seed?: () => number;
  db?: PrismaClient;
  redis?: Redis;
  logger?: boolean;
  /** RPC to use in chain mode instead of connecting to the cluster (tests pass an in-process chain). */
  chainRpc?: ChainRpc;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const cfg = loadConfig(opts.config);
  const app = Fastify({
    logger: opts.logger ?? cfg.env !== 'test',
    trustProxy: true, // behind Nginx; the API itself listens on localhost only
    bodyLimit: 256 * 1024,
  });
  const db = opts.db ?? createDb(cfg);
  const redis = opts.redis ?? createRedis(cfg);
  const ctx: Ctx = {
    db, redis, cfg,
    clock: opts.clock ?? { now: () => new Date() },
    http: opts.http ?? ((url, init) => fetch(url, init)),
    log: app.log,
    seed: opts.seed ?? (() => randomInt(1, 2 ** 31 - 1)),
    devCodes: new Map(),
    stream: undefined as unknown as StreamService,
    chain: null,
  };
  ctx.stream = new StreamService(ctx);
  ctx.stream.endRun = (runId, how, snap) => endRunFromStream(ctx, runId, how, snap);
  app.decorate('ctx', ctx);
  if (cfg.chain.mode !== 'off') {
    // Refuses mainnet (by name, by URL and by genesis hash) and a half-configured chain: the
    // server does not start in either case.
    try {
      ctx.chain = await ChainService.create(cfg.chain, app.log, opts.chainRpc);
      // Balances from before chain mode (the free starting tChips) have nothing behind them on-chain.
      const [ops, deposits, held] = await Promise.all([db.chainOp.count(), db.ledger.count({ where: { reason: 'deposit' } }), db.user.aggregate({ _sum: { balance: true } })]);
      if (ops === 0 && deposits === 0 && (held._sum.balance ?? 0) > 0) {
        throw new Error('CHAIN_MODE is on, but this database holds tChips balances that are not backed on-chain. Start chain mode on a fresh database (deploy/phase3-devnet.md).');
      }
      await syncRewardsPot(ctx);
    } catch (e) {
      if (!opts.db) await db.$disconnect();
      if (!opts.redis) redis.disconnect();
      throw e;
    }
  }

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.code === 'rate_limited' && err.details?.retryAfter) void reply.header('retry-after', String(err.details.retryAfter));
      // There is no refill in chain mode, so the standard text would point at something that is not there.
      if (ctx.chain && err.code === 'not_enough_chips' && err.message.includes('Refill')) {
        return reply.code(err.status).send(new AppError(err.status, err.code, 'Not enough tChips. Deposit test tokens from the Wallet.').body());
      }
      return reply.code(err.status).send(err.body());
    }
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    const body = new AppError(status, status === 500 ? 'internal' : status === 404 ? 'not_found' : 'invalid', status === 500 ? 'Something went wrong.' : err.message).body();
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send(new AppError(404, 'not_found', 'Not found.').body()));

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: LIMITS.streamMaxPayload } });
  registerSessions(app);
  registerRateLimits(app);
  registerCsrf(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(gameRoutes);
      await api.register(runRoutes);
      await api.register(duelRoutes);
      await api.register(challengeRoutes);
      await api.register(rewardRoutes);
      await api.register(notificationRoutes);
      await api.register(chainRoutes);
    },
    { prefix: '/api' },
  );

  app.addHook('onClose', async () => {
    ctx.stream.stop();
    if (!opts.db) await db.$disconnect();
    if (!opts.redis) redis.disconnect();
  });
  return app;
}

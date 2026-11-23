import type { HealthResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply): Promise<HealthResponse> => {
    try {
      await app.ctx.db.$queryRaw`SELECT 1`;
      if ((await app.ctx.redis.ping()) !== 'PONG') throw new Error('redis');
      return { ok: true };
    } catch (e) {
      app.ctx.log.error(e, 'health check failed');
      void reply.code(503);
      return { ok: false };
    }
  });
}

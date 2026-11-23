import type { NotificationsResponse, OkResponse } from '@podium/shared';
import type { FastifyInstance } from 'fastify';
import { LIMITS } from '../config';
import { requireUser } from '../plugins/session';

export default async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/notifications', async (req): Promise<NotificationsResponse> => {
    const user = requireUser(req);
    const [rows, unread] = await Promise.all([
      ctx.db.notification.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMITS.notificationRows }),
      ctx.db.notification.count({ where: { userId: user.id, read: false } }),
    ]);
    return { items: rows.map((n) => ({ id: n.id, kind: n.kind, body: n.body, read: n.read, at: n.createdAt.toISOString() })), unread };
  });

  // Marking read is naturally idempotent, so it needs no Idempotency-Key.
  app.post('/notifications/read', async (req): Promise<OkResponse> => {
    const user = requireUser(req);
    await ctx.db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
    return { ok: true };
  });
}

// Idempotent mutations. The handler runs inside one database transaction; its answer is stored in
// the Idempotency table in that same transaction, keyed by "<userId>:<route>:<Idempotency-Key>".
// A replay returns the stored status and body and changes nothing.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TX } from '../config';
import type { After, Ctx, Tx } from '../ctx';
import { invalid } from '../errors';
import { isUniqueViolation } from '../util';

export interface Handled<T> {
  status: number;
  body: T;
  /** Runs once after the transaction commits (never on a replay). */
  after?: After;
}

/** Reads and validates the Idempotency-Key header (8 to 64 characters). */
export function idemKey(req: FastifyRequest): string {
  const k = req.headers['idempotency-key'];
  if (typeof k !== 'string' || !/^[A-Za-z0-9_.:-]{8,64}$/.test(k)) throw invalid('An Idempotency-Key header of 8 to 64 characters is required.');
  return k;
}

export interface Outcome<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** Sends an idempotent outcome. (Kept synchronous: a FastifyReply is thenable and must not be awaited.) */
export function sendOutcome<T>(reply: FastifyReply, o: Outcome<T>): FastifyReply {
  if (o.replayed) void reply.header('idempotent-replay', 'true');
  return reply.code(o.status).send(o.body);
}

async function run<T>(ctx: Ctx, userId: string, route: string, clientKey: string, fn: (tx: Tx) => Promise<Handled<T>>): Promise<Outcome<T>> {
  const key = `${userId}:${route}:${clientKey}`;
  const stored = async (): Promise<Outcome<T> | null> => {
    const row = await ctx.db.idempotency.findUnique({ where: { key } });
    return row ? { status: row.status, body: row.body as T, replayed: true } : null;
  };
  const before = await stored();
  if (before) return before;
  let res: Handled<T>;
  try {
    res = await ctx.db.$transaction(async (tx) => {
      const r = await fn(tx);
      await tx.idempotency.create({ data: { key, status: r.status, body: r.body as object, createdAt: ctx.clock.now() } });
      return r;
    }, TX);
  } catch (e) {
    // The same request raced us and committed first: our transaction rolled back, theirs is the answer.
    if (isUniqueViolation(e)) {
      const again = await stored();
      if (again) return again;
    }
    throw e;
  }
  await res.after?.();
  return { status: res.status, body: res.body, replayed: false };
}

/** Runs `fn` once per (user, route, Idempotency-Key) and sends its (possibly stored) answer. */
export async function idempotent<T>(ctx: Ctx, reply: FastifyReply, userId: string, route: string, clientKey: string, fn: (tx: Tx) => Promise<Handled<T>>): Promise<void> {
  sendOutcome(reply, await run(ctx, userId, route, clientKey, fn));
}

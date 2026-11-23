import type { z } from 'zod';
import { invalid } from '../errors';

/** Parses a body / params object; a failure becomes a 400 `invalid` with the first problem. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw invalid(i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'Invalid request.');
}

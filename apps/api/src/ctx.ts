// What every service needs. Built once in app.ts and passed around instead of globals.
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Config } from './config';
import type { StreamService } from './services/stream';

export interface Clock {
  now(): Date;
}

/** Minimal fetch used for Google OAuth, injectable so tests can stub it. */
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Logger {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface Ctx {
  db: PrismaClient;
  redis: Redis;
  cfg: Config;
  clock: Clock;
  http: HttpFetch;
  log: Logger;
  /** Run seeds; tests fix it to get reproducible scores. */
  seed(): number;
  /** Sign-in codes that were logged instead of emailed (non-production without SMTP). Read by tests. */
  devCodes: Map<string, string>;
  stream: StreamService;
}

export type Tx = Prisma.TransactionClient;

/** Work to do once the transaction has committed (cache and sorted-set updates). */
export type After = () => Promise<void>;

// Environment and server-only tunables. Economy numbers do NOT live here: they come from @podium/shared.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  sessionSecret: string;
  /** Public origin of the site, no trailing slash. */
  publicUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  smtpUrl: string;
  emailFrom: string;
  /** Ranked, Cup and duel finishes must be backed by the live input stream. */
  requireStream: boolean;
  /** Multiplies every rate limit; tests raise it so they are not throttled. */
  rateScale: number;
}

let envLoaded = false;
/** Loads .env from the working directory, apps/api or the repo root, whichever exist. Never overrides real env vars. */
export function loadEnvFiles(): void {
  if (envLoaded) return;
  envLoaded = true;
  for (const p of ['.env', 'apps/api/.env', '../../.env']) {
    const f = resolve(process.cwd(), p);
    if (existsSync(f)) dotenv.config({ path: f });
  }
}

export function loadConfig(over: Partial<Config> = {}): Config {
  loadEnvFiles();
  const e = process.env;
  const env = (e.NODE_ENV === 'production' ? 'production' : e.NODE_ENV === 'test' ? 'test' : 'development') as Config['env'];
  const cfg: Config = {
    env,
    port: Number(e.PORT || 4000),
    host: e.HOST || '127.0.0.1',
    databaseUrl: e.DATABASE_URL || '',
    redisUrl: e.REDIS_URL || 'redis://127.0.0.1:6379',
    sessionSecret: e.SESSION_SECRET || '',
    publicUrl: (e.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    googleClientId: e.GOOGLE_CLIENT_ID || '',
    googleClientSecret: e.GOOGLE_CLIENT_SECRET || '',
    smtpUrl: e.EMAIL_SMTP_URL || '',
    emailFrom: e.EMAIL_FROM || 'Podium <no-reply@example.com>',
    requireStream: e.REQUIRE_STREAM !== '0',
    rateScale: Number(e.RATE_LIMIT_SCALE || 1) || 1,
    ...over,
  };
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL is not set');
  if (cfg.sessionSecret.length < 16) {
    if (cfg.env === 'production') throw new Error('SESSION_SECRET must be set to at least 16 characters');
    cfg.sessionSecret = cfg.sessionSecret || 'dev-only-secret-do-not-use-in-production';
  }
  return cfg;
}

// ---------------------------------------------------------------- server tunables (not economy)
export const SESSION = {
  cookie: 'podium_sid',
  ttlSeconds: 30 * 86_400,
  /** A session that has not signed in or become a guest yet (it only carries the CSRF token). */
  anonTtlSeconds: 86_400,
} as const;

export const AUTH = {
  codeTtlSeconds: 600,
  codeMaxAttempts: 5,
  nonceTtlSeconds: 600,
  oauthStateTtlSeconds: 600,
} as const;

/** [max requests, window in seconds]. */
export const RATE = {
  mutationPerIp: [240, 60],
  mutationPerUser: [60, 60],
  mutationPerDevice: [120, 60],
  authPerIp: [10, 60],
  emailCodesPerEmail: [5, 900],
  guestsPerIp: [20, 3600],
  signupsPerDevice: [5, 86_400],
  readsPerIp: [600, 60],
} as const satisfies Record<string, readonly [number, number]>;

export const LIMITS = {
  /** Slack when comparing claimed play time with wall-clock time. */
  clockSlackMs: 2000,
  gamesCacheSeconds: 5,
  boardRows: 50,
  boardCacheSeconds: 600,
  activityRows: 12,
  notificationRows: 20,
  duelHistory: 8,
  passedYouMax: 5,
  finishBodyBytes: 12 * 1024 * 1024,
  streamMaxPayload: 256 * 1024,
  closeLockMs: 55_000,
  jobEveryMs: 60_000,
  idempotencyKeepDays: 7,
  staleRunDays: 3,
} as const;

/** Interactive transaction limits (the replay itself runs outside the transaction). */
export const TX = { maxWait: 10_000, timeout: 20_000 } as const;

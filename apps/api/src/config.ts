// Environment and server-only tunables. Economy numbers do NOT live here: they come from @podium/shared.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND, CHAIN_ECONOMY } from '@podium/shared';
import dotenv from 'dotenv';

/**
 * Phase 3 (Solana DEVNET / LOCAL VALIDATOR only, valueless test token). `mode` is the only switch:
 * 'off' keeps everything as it was. There is no value that selects mainnet.
 */
export interface ChainSettings {
  mode: 'off' | 'localnet' | 'devnet';
  /** Optional RPC override; empty = the cluster's public endpoint. Still refused if it is mainnet. */
  rpcUrl: string;
  programId: string;
  mint: string;
  /** Path to a JSON keypair file, or the JSON array itself. */
  operatorKeypair: string;
  /** The test mint's authority; set = the test-token faucet is on. */
  faucetKeypair: string;
  /** Whole tChips per faucet request. */
  faucetAmount: number;
  /** ISO country codes, upper case. */
  blockedCountries: string[];
  allowedCountries: string[];
  /** Request header that carries the visitor's country (set by the CDN or Nginx GeoIP). */
  geoHeader: string;
}

/** Same text as MAINNET_LOCKED_MESSAGE in @podium/chain (kept here so config needs no chain code). */
const LOCKED =
  'Podium: mainnet is locked until the owner has a written legal opinion and a contract audit. ' +
  'Only localnet and devnet (valueless test token) are allowed.';

/** 'off' (also for unset), 'localnet' or 'devnet'. Anything else stops the server. */
export function parseChainMode(raw: string | undefined): ChainSettings['mode'] {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'off') return 'off';
  if (v === 'localnet' || v === 'devnet') return v;
  throw new Error(`CHAIN_MODE "${raw}" is not allowed. Use off, localnet or devnet. ${LOCKED}`);
}

const countries = (raw: string | undefined): string[] =>
  (raw ?? '').split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);

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
  chain: ChainSettings;
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
    emailFrom: e.EMAIL_FROM || `${BRAND.name} <no-reply@example.com>`,
    requireStream: e.REQUIRE_STREAM !== '0',
    rateScale: Number(e.RATE_LIMIT_SCALE || 1) || 1,
    chain: {
      mode: parseChainMode(e.CHAIN_MODE),
      rpcUrl: (e.SOLANA_RPC_URL || '').trim(),
      programId: (e.PODIUM_PROGRAM_ID || '').trim(),
      mint: (e.PODIUM_MINT || '').trim(),
      operatorKeypair: (e.CHAIN_OPERATOR_KEYPAIR || '').trim(),
      faucetKeypair: (e.CHAIN_FAUCET_KEYPAIR || '').trim(),
      faucetAmount: Math.floor(Number(e.CHAIN_FAUCET_AMOUNT || CHAIN_ECONOMY.faucetAmount)) || CHAIN_ECONOMY.faucetAmount,
      blockedCountries: countries(e.BLOCKED_COUNTRIES),
      allowedCountries: countries(e.ALLOWED_COUNTRIES),
      geoHeader: (e.GEO_HEADER || 'cf-ipcountry').trim().toLowerCase(),
    },
    ...over,
  };
  // An override (tests) is held to the same rule as the environment.
  cfg.chain = { ...cfg.chain, mode: parseChainMode(cfg.chain.mode) };
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
  // ---- Phase 3 (devnet test token)
  /** How many recent signatures of a player's account are scanned for deposits that were never confirmed to the API. */
  chainReconcileSignatures: 25,
  chainSeenKeepSeconds: 30 * 86_400,
  /** The outbox worker's Redis lock; refreshed before every operation. */
  chainLockMs: 180_000,
  chainPollMs: 500,
  chainBackoffMaxMs: 30_000,
  /** How long POST /chain/withdraw/submit waits for the transaction before answering "submitted". */
  withdrawWaitMs: 45_000,
  withdrawPollMs: 800,
} as const;

/** Interactive transaction limits (the replay itself runs outside the transaction). */
export const TX = { maxWait: 10_000, timeout: 20_000 } as const;

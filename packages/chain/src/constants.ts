// Browser-safe. Program id, seeds and the economy numbers as they are stored on-chain.
import { PublicKey } from '@solana/web3.js';

/**
 * Id compiled into the program when it is built WITHOUT `PODIUM_PROGRAM_ID` (tests, localnet).
 * Its keypair is derived from a public seed (see localnet.ts), so anyone can deploy at this
 * address: it is for the in-process tests and a local validator only, never for devnet.
 */
export const LOCAL_TEST_PROGRAM_ID = new PublicKey('Eo3NPwtAjr8iDSUEctJuLLhoHBho4Zm1iZKaVoWALyTz');

function envProgramId(): PublicKey {
  // Next.js only inlines NEXT_PUBLIC_* names that are written out in full.
  const fromEnv =
    typeof process !== 'undefined' && process.env
      ? process.env.PODIUM_PROGRAM_ID || process.env.NEXT_PUBLIC_PODIUM_PROGRAM_ID
      : undefined;
  return fromEnv ? new PublicKey(fromEnv) : LOCAL_TEST_PROGRAM_ID;
}

/**
 * The program this package talks to. Defaults to `PODIUM_PROGRAM_ID` /
 * `NEXT_PUBLIC_PODIUM_PROGRAM_ID` from the environment, else the local test id.
 * It is a live binding: `setProgramId()` changes it for every importer.
 */
export let PROGRAM_ID: PublicKey = envProgramId();

export function setProgramId(id: PublicKey | string): void {
  PROGRAM_ID = typeof id === 'string' ? new PublicKey(id) : id;
}

export const SEEDS = {
  config: 'config',
  vault: 'vault',
  player: 'player',
  pool: 'pool',
  duel: 'duel',
} as const;

/** Decimals of the test token and base units per whole chip. */
export const TOKEN_DECIMALS = 6;
export const DEFAULT_UNIT = 1_000_000n;
/** 6% platform fee and 10% shop burn (ECONOMY.fee / ECONOMY.shopBurn in @podium/shared), in bps. */
export const DEFAULT_FEE_BPS = 600;
export const DEFAULT_BURN_BPS = 1000;
/** Reward vesting delay used by the setup script unless told otherwise: 7 days. */
export const DEFAULT_VEST_SECONDS = 7n * 24n * 3600n;

export const POOL_KIND = { weekly: 0, cup: 1 } as const;
export type PoolKind = (typeof POOL_KIND)[keyof typeof POOL_KIND];

export const DUEL_STATE = { open: 0, matched: 1, settled: 2, refunded: 3 } as const;
export type DuelState = (typeof DUEL_STATE)[keyof typeof DUEL_STATE];

export const MAX_WINNERS = 5;
export const BPS = 10_000n;

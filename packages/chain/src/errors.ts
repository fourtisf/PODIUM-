// Browser-safe. The program's custom errors (Anchor numbers them from 6000 in declaration order).
export const PODIUM_ERRORS = [
  'Unauthorized',
  'Paused',
  'Frozen',
  'BadSequence',
  'InsufficientBalance',
  'InsufficientRewards',
  'InsufficientTreasury',
  'PoolClosed',
  'PoolNotEnded',
  'PayoutTooHigh',
  'BadSplit',
  'BadWinners',
  'BadDuelState',
  'DuelExpired',
  'BadDuelWinner',
  'BurnTooHigh',
  'Overflow',
  'InvalidAmount',
  'InvalidParam',
  'BadAccount',
  'VaultInvariant',
] as const;

export type PodiumErrorName = (typeof PODIUM_ERRORS)[number];
export const ERROR_BASE = 6000;

export const errorCode = (name: PodiumErrorName): number => ERROR_BASE + PODIUM_ERRORS.indexOf(name);
export const errorName = (code: number): PodiumErrorName | undefined => PODIUM_ERRORS[code - ERROR_BASE];

/** A transaction the program (or the runtime) rejected. Nothing was applied. */
export class PodiumProgramError extends Error {
  constructor(
    /** Program error name, or undefined when the failure was not one of the program's errors. */
    readonly code: PodiumErrorName | undefined,
    readonly customCode: number | undefined,
    readonly logs: string[],
    detail: string,
  ) {
    super(code ? `Podium program error ${code} (${customCode})` : `Podium transaction failed: ${detail}`);
    this.name = 'PodiumProgramError';
  }
}

/** Finds a custom program error number in whatever an RPC call or simulation returned. */
export function findCustomCode(err: unknown, logs: readonly string[] = []): number | undefined {
  let text = '';
  try {
    text = typeof err === 'string' ? err : JSON.stringify(err) ?? '';
  } catch {
    text = '';
  }
  if (err instanceof Error) text += ' ' + err.message;
  text += ' ' + logs.join('\n');
  const json = /"Custom"\s*:\s*(\d+)/.exec(text);
  if (json) return Number(json[1]);
  const debug = /Custom\((\d+)\)/.exec(text);
  if (debug) return Number(debug[1]);
  const hex = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
  if (hex) return parseInt(hex[1]!, 16);
  const anchor = /Error Number: (\d+)/.exec(text);
  if (anchor) return Number(anchor[1]);
  return undefined;
}

export function toProgramError(err: unknown, logs: readonly string[] = []): PodiumProgramError {
  const custom = findCustomCode(err, logs);
  let detail: string;
  try {
    detail = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    detail = String(err);
  }
  return new PodiumProgramError(custom === undefined ? undefined : errorName(custom), custom, [...logs], detail);
}

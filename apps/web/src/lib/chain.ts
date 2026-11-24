// Phase 3 switch for the web app. NEXT_PUBLIC_CHAIN_MODE is fixed at build time: unset or "off"
// means none of the devnet test-token UI exists and the API is never asked about it.
// Only "localnet" and "devnet" switch it on; there is no value for mainnet.
import type { ChainConfigResponse } from '@podium/shared';

// Client components test the build-time literal __CHAIN__ (next.config.mjs) directly, so an "off"
// build drops their chain-only branches; CHAIN_ON is the same value for server code.
export const CHAIN_ON: boolean = __CHAIN__;

/** The API's chain config when chain mode is really on at both ends, else null. */
export const liveChain = (c: ChainConfigResponse | null | undefined): ChainConfigResponse | null =>
  __CHAIN__ && c && (c.mode === 'localnet' || c.mode === 'devnet') && c.programId && c.mint ? c : null;

export const shortAddress = (a: string): string => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

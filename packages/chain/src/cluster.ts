// Browser-safe. Phase 3 is unblocked for devnet and localnet only.
export const CLUSTERS = {
  localnet: { name: 'localnet', rpcUrl: 'http://127.0.0.1:8899' },
  devnet: { name: 'devnet', rpcUrl: 'https://api.devnet.solana.com' },
} as const;

export type ClusterName = keyof typeof CLUSTERS;

export const MAINNET_LOCKED_MESSAGE =
  'Podium: mainnet is locked until the owner has a written legal opinion and a contract audit. ' +
  'Only localnet and devnet (valueless test token) are allowed.';

/** Genesis hash of mainnet-beta, to catch a mainnet RPC behind a custom URL. */
export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

function looksLikeMainnet(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === 'mainnet' || v === 'm' || v.includes('mainnet');
}

/**
 * Returns the cluster for 'localnet' or 'devnet'. Throws for 'mainnet-beta', any mainnet URL and
 * anything else it does not know.
 */
export function assertCluster(name: string): (typeof CLUSTERS)[ClusterName] {
  if (typeof name !== 'string') throw new Error('Podium: unknown cluster');
  if (looksLikeMainnet(name)) throw new Error(MAINNET_LOCKED_MESSAGE);
  const key = name.trim().toLowerCase();
  if (key === 'localnet' || key === 'localhost') return CLUSTERS.localnet;
  if (key === 'devnet') return CLUSTERS.devnet;
  throw new Error(`Podium: unknown cluster "${name}". Use "localnet" or "devnet". ${MAINNET_LOCKED_MESSAGE}`);
}

/**
 * Checks a custom RPC URL. Throws when the URL names mainnet. A URL cannot prove which cluster is
 * behind it, so servers must also call `assertNotMainnetGenesis` once connected.
 */
export function assertRpcUrl(url: string): string {
  if (looksLikeMainnet(url)) throw new Error(MAINNET_LOCKED_MESSAGE);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Podium: "${url}" is not an RPC URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Podium: "${url}" is not an RPC URL`);
  return url;
}

/** Asks the RPC node for its genesis hash and throws if it is mainnet-beta. */
export async function assertNotMainnetGenesis(connection: { getGenesisHash(): Promise<string> }): Promise<void> {
  const hash = await connection.getGenesisHash();
  if (hash === MAINNET_GENESIS_HASH) throw new Error(MAINNET_LOCKED_MESSAGE);
}

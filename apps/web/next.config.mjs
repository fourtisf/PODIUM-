// Next.js config. In production Nginx sends /api to Fastify itself; the rewrite below makes
// `next dev` and `next start` work on their own too.
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
// Phase 3 (devnet test token) is a build-time switch. Only "localnet" and "devnet" turn it on;
// anything else, mainnet included, builds the site without any of the chain UI.
const chainOn = process.env.NEXT_PUBLIC_CHAIN_MODE === 'localnet' || process.env.NEXT_PUBLIC_CHAIN_MODE === 'devnet';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@podium/shared', '@podium/games', '@podium/chain'],
  experimental: {
    // Pages show live balances and boards: never reuse a client-cached dynamic page.
    staleTimes: { dynamic: 0 },
  },
  webpack(config, { webpack }) {
    // A literal the bundler can see through: an "off" build drops every chain-only branch and import.
    config.plugins.push(new webpack.DefinePlugin({ __CHAIN__: JSON.stringify(chainOn) }));
    return config;
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;

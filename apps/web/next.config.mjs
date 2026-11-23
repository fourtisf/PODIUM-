// Next.js config. In production Nginx sends /api to Fastify itself; the rewrite below makes
// `next dev` and `next start` work on their own too.
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@podium/shared', '@podium/games'],
  experimental: {
    // Pages show live balances and boards: never reuse a client-cached dynamic page.
    staleTimes: { dynamic: 0 },
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;

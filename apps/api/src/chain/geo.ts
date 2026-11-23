// Country blocking for value features (HANDOFF.md section 8). Only in chain mode. The country
// comes from a header the CDN or Nginx GeoIP sets (GEO_HEADER, default cf-ipcountry); the API
// listens on localhost behind that proxy, so the header cannot be set by the visitor as long as
// the proxy overwrites it (see deploy/phase3-devnet.md).
import type { FastifyRequest } from 'fastify';
import type { Ctx } from '../ctx';
import { AppError } from '../errors';
import { walletRequired } from './outbox';

export function countryOf(ctx: Ctx, req: FastifyRequest): string | null {
  const raw = req.headers[ctx.cfg.chain.geoHeader];
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return v && /^[A-Z0-9]{2}$/.test(v) ? v : null;
}

/**
 * With ALLOWED_COUNTRIES set only those countries may use value features, and a request without
 * a country is refused (fail closed). Otherwise BLOCKED_COUNTRIES are refused and a request
 * without a country is let through.
 */
export function countryBlocked(ctx: Ctx, req: FastifyRequest): boolean {
  if (!ctx.chain) return false;
  const s = ctx.cfg.chain;
  const c = countryOf(ctx, req);
  if (s.allowedCountries.length) return !c || !s.allowedCountries.includes(c);
  return !!c && s.blockedCountries.includes(c);
}

export function assertCountry(ctx: Ctx, req: FastifyRequest): void {
  if (countryBlocked(ctx, req)) throw new AppError(451, 'country_blocked', 'This is not available in your country. Practice and the leaderboards stay open.');
}

/**
 * Gate for value features (ranked, Cup and duel entries, the shop, rewards, deposits,
 * withdrawals, the faucet). While CHAIN_MODE is off it does nothing.
 */
export function requireValue(ctx: Ctx, req: FastifyRequest, user: { wallet: string | null }): void {
  if (!ctx.chain) return;
  assertCountry(ctx, req);
  if (!user.wallet) throw walletRequired();
}

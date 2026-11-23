// Server-side reads of the API for the first paint. Forwards the visitor's cookie; never throws.
import 'server-only';
import { cache } from 'react';
import { cookies, headers as headers_ } from 'next/headers';
import { CHAIN_ON } from './chain';

const GEO_HEADER = (process.env.GEO_HEADER || 'cf-ipcountry').toLowerCase();

const BASE = (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

const load = cache(async (path: string, anonymous: boolean): Promise<unknown> => {
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (!anonymous) {
      const cookie = cookies().toString();
      if (cookie) headers.cookie = cookie;
    }
    // Chain mode: the API decides country blocking from the header the CDN / Nginx set on the visitor's request.
    if (CHAIN_ON) {
      const country = headers_().get(GEO_HEADER);
      if (country) headers[GEO_HEADER] = country;
    }
    const res = await fetch(`${BASE}/api${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
});

/** GET /api<path> as the current visitor. Returns null on any failure (signed out, API down). One fetch per path per request. */
export const serverGet = <T>(path: string, opts: { anonymous?: boolean } = {}): Promise<T | null> => load(path, !!opts.anonymous) as Promise<T | null>;

export const publicUrl = (): string => (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

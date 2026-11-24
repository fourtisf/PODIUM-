// /robots.txt: everything public may be crawled except the operator tools and the API.
import type { MetadataRoute } from 'next';
import { publicUrl } from '@/lib/server-api';

// Read PUBLIC_URL when the request comes in, not at build time.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api'] }],
    sitemap: `${publicUrl()}/sitemap.xml`,
  };
}

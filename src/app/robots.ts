import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

// runtime: SITE_URL is a container env var, not a build-time ARG
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // the admin console lives under /app — bare /admin is just its 301
          '/app/admin',
          '/api/',
          '/oauth',
          '/login',
          '/signup',
          '/forgot-password',
          '/reset-password',
        ],
      },
    ],
    sitemap: `${config.siteUrl}/sitemap.xml`,
  };
}

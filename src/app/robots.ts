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
        disallow: ['/admin', '/api/'],
      },
    ],
    sitemap: `${config.siteUrl}/sitemap.xml`,
  };
}

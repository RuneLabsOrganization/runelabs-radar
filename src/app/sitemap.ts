import type { MetadataRoute } from 'next';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { stories } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { DOMAINS } from '@/lib/domains';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = config.siteUrl;
  const staticRoutes = ['', '/board', '/stacks', '/opportunities', '/map', '/brief', '/changelog'].map(
    (p) => ({
      url: `${base}${p}`,
      changeFrequency: 'hourly' as const,
      priority: p === '' ? 1 : 0.8,
    }),
  );
  const domainRoutes = DOMAINS.map((d) => ({
    url: `${base}/domain/${d}`,
    changeFrequency: 'hourly' as const,
    priority: 0.7,
  }));

  let storyRoutes: MetadataRoute.Sitemap = [];
  try {
    const recent = getDb()
      .select({ id: stories.id, createdAt: stories.createdAt })
      .from(stories)
      .where(
        // sitemap carries the last 30 days of curated contacts
        and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - 30 * 24 * 36e5))),
      )
      .orderBy(desc(stories.createdAt))
      .limit(1000)
      .all();
    storyRoutes = recent.map((s) => ({
      url: `${base}/story/${s.id}`,
      lastModified: s.createdAt,
      changeFrequency: 'never' as const,
      priority: 0.6,
    }));
  } catch {
    // no database yet (fresh install) — static routes only
  }

  return [...staticRoutes, ...domainRoutes, ...storyRoutes];
}

import type { MetadataRoute } from 'next';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { opportunities, stories } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { DOMAINS } from '@/lib/domains';
import { topEntitySlugs } from '@/lib/entity';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = config.siteUrl;
  const staticRoutes = [
    '',
    '/board',
    '/stacks',
    '/agent-stacks',
    '/agent-plans',
    '/opportunities',
    '/map',
    '/brief',
    '/changelog',
    '/accuracy',
  ].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: 'hourly' as const,
    priority: p === '' ? 1 : 0.8,
  }));
  const domainRoutes = DOMAINS.map((d) => ({
    url: `${base}/domain/${d}`,
    changeFrequency: 'hourly' as const,
    priority: 0.7,
  }));

  let storyRoutes: MetadataRoute.Sitemap = [];
  let entityRoutes: MetadataRoute.Sitemap = [];
  let opportunityRoutes: MetadataRoute.Sitemap = [];
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
    entityRoutes = topEntitySlugs(200).map((slug) => ({
      url: `${base}/entity/${slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));
    opportunityRoutes = getDb()
      .select({ id: opportunities.id, firstSeenAt: opportunities.firstSeenAt })
      .from(opportunities)
      .where(eq(opportunities.status, 'active'))
      .all()
      .map((o) => ({
        url: `${base}/opportunities/${o.id}`,
        lastModified: o.firstSeenAt,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      }));
  } catch {
    // no database yet (fresh install) — static routes only
  }

  return [...staticRoutes, ...domainRoutes, ...entityRoutes, ...opportunityRoutes, ...storyRoutes];
}

import type { MetadataRoute } from 'next';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { opportunities, stories } from '@/lib/db/schema';
import { DOMAINS } from '@/lib/domains';
import { topEntitySlugs } from '@/lib/entity';
import { urls } from '@/lib/urls';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    { url: urls.home(), changeFrequency: 'hourly' as const, priority: 1 },
    { url: urls.mcp(), changeFrequency: 'weekly' as const, priority: 0.9 },
    { url: urls.pricing(), changeFrequency: 'weekly' as const, priority: 0.9 },
    { url: urls.trust(), changeFrequency: 'weekly' as const, priority: 0.8 },
    { url: urls.changelog(), changeFrequency: 'daily' as const, priority: 0.7 },
    { url: urls.reports(), changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: urls.app(), changeFrequency: 'hourly' as const, priority: 0.9 },
    { url: urls.tools(), changeFrequency: 'hourly' as const, priority: 0.8 },
    { url: urls.stacks(), changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: urls.agents(), changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: urls.opportunities(), changeFrequency: 'hourly' as const, priority: 0.8 },
    { url: urls.map(), changeFrequency: 'daily' as const, priority: 0.7 },
    { url: urls.brief(), changeFrequency: 'daily' as const, priority: 0.8 },
    { url: urls.connect(), changeFrequency: 'weekly' as const, priority: 0.8 },
  ];

  const domainRoutes = DOMAINS.map((d) => ({
    url: urls.domain(d),
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
      .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - 30 * 24 * 36e5))))
      .orderBy(desc(stories.createdAt))
      .limit(1000)
      .all();
    storyRoutes = recent.map((s) => ({
      url: urls.story(s.id),
      lastModified: s.createdAt,
      changeFrequency: 'never' as const,
      priority: 0.6,
    }));
    entityRoutes = topEntitySlugs(200).map((slug) => ({
      url: urls.entity(slug),
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));
    opportunityRoutes = getDb()
      .select({ id: opportunities.id, slug: opportunities.slug, firstSeenAt: opportunities.firstSeenAt })
      .from(opportunities)
      .where(eq(opportunities.status, 'active'))
      .all()
      .map((o) => ({
        url: urls.opportunity(o.slug),
        lastModified: o.firstSeenAt,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      }));
  } catch {
    // no database yet
  }

  return [...staticRoutes, ...domainRoutes, ...entityRoutes, ...opportunityRoutes, ...storyRoutes];
}

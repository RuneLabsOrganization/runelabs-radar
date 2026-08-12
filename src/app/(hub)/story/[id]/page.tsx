import { notFound } from 'next/navigation';
import Link from 'next/link';
import { desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, sources, stories } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { DOMAIN_COLORS, DOMAIN_LABELS, DOMAINS, type Domain } from '@/lib/domains';
import { timeAgo } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import { parseDomainScores, topDomain } from '@/components/DomainChips';
import SignalMeter from '@/components/SignalMeter';

function storySources(db: ReturnType<typeof getDb>, storyId: number) {
  return db
    .select({ url: items.url, name: sources.name, publishedAt: items.publishedAt })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.storyId, storyId))
    .orderBy(items.id)
    .all();
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getDb()
    .select()
    .from(stories)
    .where(eq(stories.id, Number(id)))
    .get();
  if (!story) return {};
  const description = story.tldr ?? story.whyItMatters ?? undefined;
  return {
    title: story.title,
    description,
    openGraph: { title: story.title, description, type: 'article' },
  };
}

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storyId = Number(id);
  if (!Number.isInteger(storyId) || storyId <= 0) notFound();

  await requireViewer();
  const db = getDb();
  const story = db.select().from(stories).where(eq(stories.id, storyId)).get();
  if (!story) notFound();

  const srcs = storySources(db, storyId);
  const scores = parseDomainScores(story.domainScores);
  const primary = topDomain(scores);

  // related: same primary domain, recent, excluding self
  const recent = db
    .select()
    .from(stories)
    .where(
      gt(stories.createdAt, new Date(Date.now() - 14 * 24 * 36e5)),
    )
    .orderBy(desc(stories.topScore))
    .limit(200)
    .all();
  const related = recent
    .filter((s) => s.id !== story.id && s.status === 'curated')
    .filter((s) => topDomain(parseDomainScores(s.domainScores)) === primary)
    .slice(0, 5);

  const canonical = `${config.siteUrl}/story/${story.id}`;
  const firstUrl = safeHttpUrl(srcs[0]?.url);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: story.title,
    description: story.tldr ?? undefined,
    datePublished: story.createdAt.toISOString(),
    mainEntityOfPage: canonical,
    isBasedOn: srcs.map((s) => s.url).filter(Boolean),
    author: { '@type': 'Organization', name: getIdentity().productName },
  };

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="readout">
        <Link href="/" className="hover:underline">
          briefing
        </Link>{' '}
        &middot; contact #{story.id} &middot; {timeAgo(story.createdAt)}
      </div>

      <div className="mt-3 flex items-start gap-3.5">
        <div className="pt-[7px]">
          <SignalMeter score={story.topScore} />
        </div>
        <h1 className="text-[19px] leading-snug font-semibold tracking-[-0.01em]">{story.title}</h1>
      </div>

      {scores && (
        <div className="mono mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px] tracking-[0.06em] uppercase">
          {DOMAINS.map((d: Domain) => {
            const v = scores[d] ?? 0;
            if (v === 0) return null;
            return (
              <Link
                key={d}
                href={`/domain/${d}`}
                className="inline-flex items-center gap-1.5 rounded-[3px] border border-[var(--grat)] px-2 py-1 transition-colors hover:border-[var(--grat-strong)]"
              >
                <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
                <span style={{ color: 'var(--ink-2)' }}>{DOMAIN_LABELS[d]}</span>
                <span style={{ color: 'var(--ink-4)' }}>{v}</span>
              </Link>
            );
          })}
        </div>
      )}

      {story.tldr && (
        <p className="mt-5 text-[14px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          {story.tldr}
        </p>
      )}

      {story.whyItMatters && (
        <p
          className="mt-4 border-l-2 pl-3 text-[13.5px] leading-relaxed"
          style={{ borderColor: 'var(--phosphor)', color: 'var(--ink-2)' }}
        >
          <span className="readout" style={{ color: 'var(--phosphor)' }}>
            why it matters
          </span>{' '}
          &mdash; {story.whyItMatters}
        </p>
      )}

      {story.whyShown && (
        <p className="mono mt-2 text-[10.5px] tracking-[0.04em]" style={{ color: 'var(--ink-4)' }}>
          scoped because <span style={{ color: 'var(--ink-3)' }}>{story.whyShown}</span>
        </p>
      )}

      {story.secondLook && (
        <p
          className="mt-4 border-l-2 pl-3 text-[13.5px] leading-relaxed"
          style={{ borderColor: 'var(--amber)', color: 'var(--ink-2)' }}
        >
          <span className="readout" style={{ color: 'var(--amber)' }}>
            second look
          </span>{' '}
          &mdash; {story.secondLook}
        </p>
      )}

      {firstUrl && (
        <p className="mt-5">
          <a href={firstUrl} target="_blank" rel="noreferrer" className="btn">
            read the source &#8599;
          </a>
        </p>
      )}

      {srcs.length > 0 && (
        <>
          <div className="readout mt-8 mb-2">sources &middot; {srcs.length}</div>
          <ul>
            {srcs.map((s, i) => {
              const href = safeHttpUrl(s.url);
              return (
                <li
                  key={i}
                  className="flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
                >
                  <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                    {s.name}
                  </span>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                      style={{ color: 'var(--ink-2)' }}
                    >
                      {s.url}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-3)' }}>
                      {s.url}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {related.length > 0 && (
        <>
          <div className="readout mt-8 mb-2">related contacts</div>
          <ul>
            {related.map((r) => (
              <li
                key={r.id}
                className="row-hover flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
              >
                <span className="mono w-8 shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  {r.topScore}
                </span>
                <Link
                  href={`/story/${r.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {r.title}
                </Link>
                <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  {timeAgo(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

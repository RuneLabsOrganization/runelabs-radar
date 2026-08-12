import { notFound } from 'next/navigation';
import Link from 'next/link';
import { desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, sources, stories } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { entitySlug } from '@/lib/entity';
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

  // entities mentioned in the story → watch-page chips
  const entities: { name: string; kind?: string }[] = (() => {
    try {
      const parsed = JSON.parse(story.entities ?? '[]') as { name?: unknown }[];
      return Array.isArray(parsed)
        ? parsed.filter((e) => typeof e?.name === 'string').slice(0, 5) as { name: string }[]
        : [];
    } catch {
      return [];
    }
  })();

  // domain fit: nonzero scores, strongest first — the right-rail bar list
  const fit = scores
    ? DOMAINS.map((d) => ({ d, v: scores[d] ?? 0 }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
    : [];

  const srcNames = [...new Set(srcs.map((s) => s.name).filter(Boolean))];

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0">
          {/* kicker: where this story lives, before the text */}
          <div className="mono flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10.5px] tracking-[0.08em] uppercase">
            <Link href="/" className="hover:underline" style={{ color: 'var(--ink-4)' }}>
              today
            </Link>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            {primary && (
              <Link
                href={`/domain/${primary}`}
                className="inline-flex items-center gap-1.5 hover:underline"
                style={{ color: 'var(--ink-3)' }}
              >
                <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[primary] }} />
                {DOMAIN_LABELS[primary]}
              </Link>
            )}
            {entities.map((e) => (
              <Link
                key={e.name}
                href={`/entity/${entitySlug(e.name)}`}
                className="rounded-[3px] border border-[var(--grat-soft)] px-1.5 py-0.5 transition-colors hover:border-[var(--grat-strong)]"
                style={{ color: 'var(--ink-3)' }}
              >
                {e.name}
              </Link>
            ))}
          </div>

          <div className="mt-3 flex items-start gap-3.5">
            <div className="pt-[7px]">
              <SignalMeter score={story.topScore} />
            </div>
            <h1 className="text-[21px] leading-snug font-semibold tracking-[-0.01em]">{story.title}</h1>
          </div>

          {/* attribution row: who reported it, when, how corroborated */}
          <div className="mono mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
            {srcNames.length > 0 && <span style={{ color: 'var(--ink-3)' }}>{srcNames.join(' + ')}</span>}
            <span>{timeAgo(story.createdAt)}</span>
            {srcs.length > 1 && <span>{srcs.length} sources</span>}
            <span>signal {story.topScore}</span>
          </div>

          {story.tldr && (
            <p className="mt-5 text-[15px] leading-relaxed" style={{ color: 'var(--ink)' }}>
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

          {story.whyShown && (
            <p className="mono mt-2 text-[10.5px] tracking-[0.04em]" style={{ color: 'var(--ink-4)' }}>
              scoped because <span style={{ color: 'var(--ink-3)' }}>{story.whyShown}</span>
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
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                          style={{ color: 'var(--ink-2)' }}
                        >
                          {s.name} <span style={{ color: 'var(--ink-4)' }}>&#8599;</span>
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-3)' }}>
                          {s.name}
                        </span>
                      )}
                      {s.publishedAt && (
                        <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                          {timeAgo(s.publishedAt)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* right rail: domain fit + more like this */}
        <aside className="min-w-0">
          {fit.length > 0 && (
            <div>
              <div className="readout mb-2.5">domain fit</div>
              <div className="flex flex-col gap-[7px]">
                {fit.map(({ d, v }) => (
                  <Link key={d} href={`/domain/${d}`} className="group flex items-center gap-2">
                    <span
                      className="mono w-[64px] shrink-0 text-right text-[10px] uppercase tracking-[0.06em]"
                      style={{ color: primary === d ? 'var(--ink-2)' : 'var(--ink-4)' }}
                    >
                      {DOMAIN_LABELS[d]}
                    </span>
                    <span className="h-[4px] flex-1 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
                      <span
                        className="anim-bar block h-full rounded-[1px]"
                        style={{ width: `${v}%`, background: DOMAIN_COLORS[d], opacity: 0.9 }}
                      />
                    </span>
                    <span className="mono w-[20px] shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                      {v}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {related.length > 0 && (
            <div className="mt-7">
              <div className="readout mb-2">more like this</div>
              <ul>
                {related.map((r) => (
                  <li key={r.id} className="border-b border-[var(--grat-soft)] py-[7px] last:border-b-0">
                    <Link
                      href={`/story/${r.id}`}
                      className="block text-[13px] leading-snug hover:underline"
                      style={{ color: 'var(--ink-2)' }}
                    >
                      {r.title}
                    </Link>
                    <span className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
                      signal {r.topScore} &middot; {timeAgo(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

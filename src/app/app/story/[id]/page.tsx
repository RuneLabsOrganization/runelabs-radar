import { notFound } from 'next/navigation';
import Link from 'next/link';
import { desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, sources, stories } from '@/lib/db/schema';
import { getIdentity } from '@/lib/identity';
import { entitySlug } from '@/lib/entity';
import { DOMAIN_COLORS, DOMAIN_LABELS, DOMAINS, type Domain } from '@/lib/domains';
import { timeAgo } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import { paths, urls } from '@/lib/urls';
import { parseDomainScores, topDomain } from '@/components/DomainChips';
import { AddToBatchButton } from '@/components/batches/AddToBatchButton';
import SignalMeter from '@/components/SignalMeter';
import { WorkspaceNav } from '@/components/app/WorkspaceNav';
import { ExternalLink } from 'lucide-react';

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
  // only curated stories are public — the page itself 404s on anything else
  if (!story || story.status !== 'curated') return {};
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

  const user = await requireViewer();
  const db = getDb();
  const story = db.select().from(stories).where(eq(stories.id, storyId)).get();
  // only curated stories are public — 'raw'/'filtered' are never-display bands
  if (!story || story.status !== 'curated') notFound();

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

  const canonical = urls.story(story.id);
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
  const entities: { name: string }[] = (() => {
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
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <WorkspaceNav section="signal" />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0">
          <div className="mono flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10.5px] uppercase tracking-[0.08em]">
            <Link href={paths.signal} className="text-ink-4 hover:underline">
              today
            </Link>
            <span className="text-ink-4">·</span>
            {primary && (
              <Link
                href={paths.domain(primary)}
                className="inline-flex items-center gap-1.5 text-ink-3 hover:underline"
              >
                <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[primary] }} />
                {DOMAIN_LABELS[primary]}
              </Link>
            )}
            {entities.map((e) => (
              <Link
                key={e.name}
                href={paths.entity(entitySlug(e.name))}
                className="rounded-sm border border-grat-soft px-1.5 py-0.5 text-ink-3 transition-colors hover:border-grat-strong"
              >
                {e.name}
              </Link>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="pt-[7px]">
                <SignalMeter score={story.topScore} />
              </div>
              <h1 className="type-h1 leading-snug">{story.title}</h1>
            </div>
            <AddToBatchButton refType="story" refId={story.id} />
          </div>

          <div className="mono mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-ink-4">
            {srcNames.length > 0 && <span className="text-ink-3">{srcNames.join(' + ')}</span>}
            <span>{timeAgo(story.createdAt)}</span>
            {srcs.length > 1 && <span>{srcs.length} sources</span>}
            <span>score {story.topScore}</span>
          </div>

          {story.tldr && (
            <p className="mt-5 text-[15px] leading-relaxed text-ink">{story.tldr}</p>
          )}

          {story.whyItMatters && (
            <p className="mt-4 border-l-2 border-phosphor pl-3 text-[13.5px] leading-relaxed text-ink-2">
              <span className="readout text-phosphor">why it matters</span> — {story.whyItMatters}
            </p>
          )}

          {story.secondLook && (
            <p className="mt-4 border-l-2 border-amber pl-3 text-[13.5px] leading-relaxed text-ink-2">
              <span className="readout text-amber">second look</span> — {story.secondLook}
            </p>
          )}

          {story.whyShown && (
            <p className="mono mt-2 text-[10.5px] tracking-[0.04em] text-ink-4">
              on the radar because <span className="text-ink-3">{story.whyShown}</span>
            </p>
          )}

          {firstUrl && (
            <p className="mt-5">
              <a href={firstUrl} target="_blank" rel="noreferrer" className="btn inline-flex items-center gap-1">
                read the source
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </p>
          )}

          {srcs.length > 0 && (
            <>
              <div className="readout mb-2 mt-8">sources · {srcs.length}</div>
              <ul>
                {srcs.map((s, i) => {
                  const href = safeHttpUrl(s.url);
                  return (
                    <li
                      key={i}
                      className="flex items-baseline gap-3 border-b border-grat-soft py-[7px] text-[13px] last:border-b-0"
                    >
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-ink-2 decoration-grat-strong underline-offset-2 hover:underline"
                        >
                          {s.name}
                          <ExternalLink className="size-3 shrink-0 text-ink-4" aria-hidden />
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-ink-3">{s.name}</span>
                      )}
                      {s.publishedAt && (
                        <span className="mono shrink-0 text-[10.5px] text-ink-4">
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
                  <Link key={d} href={paths.domain(d)} className="group flex items-center gap-2">
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
                      href={paths.story(r.id)}
                      className="block text-[13px] leading-snug hover:underline"
                      style={{ color: 'var(--ink-2)' }}
                    >
                      {r.title}
                    </Link>
                    <span className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
                      score {r.topScore} &middot; {timeAgo(r.createdAt)}
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

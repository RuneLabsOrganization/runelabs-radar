// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardEntries, items, sources, stories, votes, domainDigests } from '@/lib/db/schema';
import {
  DOMAINS,
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  DOMAIN_MEMBERSHIP_THRESHOLD,
  isDomain,
} from '@/lib/domains';
import { dailyDomainCounts, domainMomentum } from '@/lib/analytics';
import { domainAffinity, personalScore, splitFeed } from '@/lib/feed';
import { visitAnchor } from '@/lib/visits';
import { allEntityNames, matchEntity } from '@/lib/stacks/match';
import { topEntitiesInDomain } from '@/lib/entity-extras';
import { parseDomainScores } from '@/components/DomainChips';
import ActivityTrace from '@/components/ActivityTrace';
import ActivityPanel from '@/components/ActivityPanel';
import ScanRow from '@/components/ScanRow';
import SectionHeader from '@/components/SectionHeader';
import PageHeader from '@/components/PageHeader';
import SectorStrip, { type SectorStat } from '@/components/SectorStrip';
import SignalEntry from '@/components/SignalEntry';
import { paths } from '@/lib/urls';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDomain(slug)) return {};
  const label = DOMAIN_LABELS[slug];
  return {
    title: `${label} — sector scan`,
    description: `AI stories scored for ${label}: top stories, sector activity and what changed — updated continuously.`,
  };
}

export default async function DomainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDomain(slug)) notFound();

  const user = await requireViewer();
  const db = getDb();

  // Same 72h scope as the briefing, re-scored through this sector's lens.
  // No row cap: every count on this page (strip, scan log, kicker) must be exact.
  // Projected to the FeedStory slice — the full row hauls a ~1.5KB embedding
  // blob per story onto this hot page.
  const curated = db
    .select({
      id: stories.id,
      title: stories.title,
      tldr: stories.tldr,
      whyItMatters: stories.whyItMatters,
      whyShown: stories.whyShown,
      domainScores: stories.domainScores,
      topScore: stories.topScore,
      createdAt: stories.createdAt,
      updatedAt: stories.updatedAt,
    })
    .from(stories)
    .where(
      and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - 72 * 36e5))),
    )
    .orderBy(desc(stories.topScore))
    .all();

  const anchor = user ? visitAnchor(user) : null;
  const digest = db
    .select()
    .from(domainDigests)
    .where(eq(domainDigests.domain, slug))
    .orderBy(desc(domainDigests.date))
    .limit(1)
    .get();
  // vote-affinity re-ranking (logged-in users only), restricted to this sector's
  // affinity — an unrelated domain's taste must not pull stories in or out
  const affinity = user
    ? domainAffinity(
        db
          .select({ value: votes.value, domainScores: stories.domainScores })
          .from(votes)
          .innerJoin(stories, eq(votes.storyId, stories.id))
          .where(eq(votes.userId, user.id))
          .all(),
      )
    : {};
  const all = curated.map((story) => {
    const scores = parseDomainScores(story.domainScores);
    const raw = scores?.[slug] ?? 0;
    return {
      story,
      scores,
      score: user ? personalScore(raw, story.domainScores, affinity, slug) : raw,
      createdAt: story.createdAt,
      isNew: anchor ? story.createdAt > anchor : false,
    };
  });

  const momentum = new Map(domainMomentum().map((m) => [m.domain, m.deltaPct]));
  const stats: SectorStat[] = DOMAINS.map((domain) => {
    let n = 0;
    let fresh = 0;
    for (const c of all) {
      if ((c.scores?.[domain] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD) {
        n += 1;
        if (c.isNew) fresh += 1;
      }
    }
    return { domain, count: n, fresh, deltaPct: momentum.get(domain) ?? null };
  });

  // membership is judged on the RAW sector score — personalization only re-ranks
  // within the sector, so this count always agrees with the sector strip
  const member = all.filter((c) => (c.scores?.[slug] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD);
  const { top, scan, lowCount } = splitFeed(member);
  const ids = member.map((c) => c.story.id);

  const itemRows = ids.length
    ? db
        .select({ storyId: items.storyId, url: items.url, sourceName: sources.name })
        .from(items)
        .innerJoin(sources, eq(items.sourceId, sources.id))
        .where(inArray(items.storyId, ids))
        .orderBy(items.id)
        .all()
    : [];
  const itemAgg = new Map<number, { count: number; firstUrl: string | null; sourceName: string | null }>();
  for (const row of itemRows) {
    if (row.storyId == null) continue;
    const agg = itemAgg.get(row.storyId) ?? { count: 0, firstUrl: null, sourceName: null };
    agg.count += 1;
    if (agg.firstUrl === null) {
      agg.firstUrl = row.url;
      agg.sourceName = row.sourceName;
    }
    itemAgg.set(row.storyId, agg);
  }

  const voteRows = ids.length
    ? db.select().from(votes).where(inArray(votes.storyId, ids)).all()
    : [];
  const voteAgg = new Map<number, { up: number; down: number; mine: 1 | -1 | 0 }>();
  for (const row of voteRows) {
    const agg = voteAgg.get(row.storyId) ?? { up: 0, down: 0, mine: 0 as const };
    if (row.value === 1) agg.up += 1;
    else if (row.value === -1) agg.down += 1;
    if (user && row.userId === user.id && (row.value === 1 || row.value === -1)) agg.mine = row.value;
    voteAgg.set(row.storyId, agg);
  }

  const fresh = member.filter((c) => c.isNew).length;

  // the sector rail: board summary + hot entities (desktop right column)
  const board = db.select().from(boardEntries).where(eq(boardEntries.domain, slug)).all();
  const entityNames = allEntityNames();
  const hot = topEntitiesInDomain(slug, 6);

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <PageHeader
        kicker={
          <>
            sector scan · {member.length} stories
            {fresh > 0 && <span className="text-phosphor"> · {fresh} new</span>}
          </>
        }
        title={
          <span className="inline-flex items-center gap-2.5">
            <span aria-hidden className="inline-block h-[14px] w-[3px]" style={{ background: DOMAIN_COLORS[slug] }} />
            {DOMAIN_LABELS[slug]}
          </span>
        }
        description={`The ${DOMAIN_LABELS[slug]} beat — every story scored for this sector, its 14-day activity trend, and its spots on the board.`}
      />

      {digest && (
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-2">
          <span className="readout mr-2">sector digest · {digest.date}</span>
          {digest.text}
        </p>
      )}

      <div className="mt-4">
        <SectorStrip stats={stats} active={slug} />
      </div>

      <SectionHeader label="Sector activity — last 14 days" />
      <ActivityPanel days={dailyDomainCounts(14)} focus={slug} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <SectionHeader label="Top stories" count={top.length} tone="phosphor" />
          {top.length === 0 ? (
            <p className="mono py-4 text-[12px] text-ink-4">
              No strong {DOMAIN_LABELS[slug]} stories in the last 72h.
            </p>
          ) : (
            <div>
              {top.map((c, i) => {
                const it = itemAgg.get(c.story.id) ?? { count: 0, firstUrl: null, sourceName: null };
                const vt = voteAgg.get(c.story.id) ?? { up: 0, down: 0, mine: 0 as const };
                return (
                  <SignalEntry
                    key={c.story.id}
                    story={c.story}
                    score={c.score}
                    itemCount={it.count}
                    firstUrl={it.firstUrl}
                    sourceName={it.sourceName}
                    up={vt.up}
                    down={vt.down}
                    myVote={vt.mine}
                    isNew={c.isNew}
                    highlightDomain={slug}
                    readOnly={!user}
                    hero={i === 0}
                  />
                );
              })}
            </div>
          )}

          {scan.length > 0 && (
            <>
              <SectionHeader label="Scan log" count={scan.length} />
              <ul>
                {scan.map((c) => (
                  <ScanRow
                    key={c.story.id}
                    story={c.story}
                    firstUrl={itemAgg.get(c.story.id)?.firstUrl ?? null}
                    score={c.score}
                    domain={slug}
                    isNew={c.isNew}
                  />
                ))}
              </ul>
            </>
          )}

          {lowCount > 0 && (
            <p className="readout mt-9">{lowCount} low-scoring stories below the threshold</p>
          )}
        </div>

        <aside className="min-w-0">
          {board.length > 0 && (
            <div>
              <div className="readout mb-2">best right now · {DOMAIN_LABELS[slug]}</div>
              <ul>
                {board.map((e) => (
                  <li key={e.id} className="border-b border-grat-soft py-[6px] text-[13px] last:border-b-0">
                    <span className="mono block text-[10px] uppercase tracking-[0.06em] text-ink-4">
                      {e.task}
                    </span>
                    {e.bestOverall ? (
                      (() => {
                        const m = matchEntity(e.bestOverall, entityNames);
                        return m ? (
                          <Link href={paths.entity(m.slug)} className="text-ink-2 hover:underline">
                            {e.bestOverall}
                          </Link>
                        ) : (
                          <span className="text-ink-2">{e.bestOverall}</span>
                        );
                      })()
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mono mt-1.5 text-[10px] text-ink-4">
                <Link href={paths.tools} className="hover:underline">
                  the full board →
                </Link>
              </p>
            </div>
          )}

          {hot.length > 0 && (
            <div className="mt-7">
              <div className="readout mb-2">hot in {DOMAIN_LABELS[slug]} · 7d</div>
              <div className="flex flex-wrap gap-1.5">
                {hot.map((h) => (
                  <Link
                    key={h.slug}
                    href={paths.entity(h.slug)}
                    className="mono rounded-sm border border-grat-soft px-2 py-1 text-[10.5px] text-ink-3 transition-colors hover:border-grat-strong"
                  >
                    {h.name} <span className="text-ink-4">{h.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

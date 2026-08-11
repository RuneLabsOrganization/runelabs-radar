import { notFound } from 'next/navigation';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, sources, stories, votes } from '@/lib/db/schema';
import {
  DOMAINS,
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  DOMAIN_MEMBERSHIP_THRESHOLD,
  isDomain,
} from '@/lib/domains';
import { dailyDomainCounts, domainMomentum } from '@/lib/analytics';
import { splitFeed } from '@/lib/feed';
import { visitAnchor } from '@/lib/visits';
import { parseDomainScores } from '@/components/DomainChips';
import ActivityTrace from '@/components/ActivityTrace';
import ScanRow from '@/components/ScanRow';
import SectionHeader from '@/components/SectionHeader';
import SectorStrip, { type SectorStat } from '@/components/SectorStrip';
import SignalEntry from '@/components/SignalEntry';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDomain(slug)) return {};
  const label = DOMAIN_LABELS[slug];
  return {
    title: `${label} — sector scan`,
    description: `AI signals scored for ${label}: top stories, sector activity and what changed — updated continuously.`,
  };
}

export default async function DomainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDomain(slug)) notFound();

  const user = await requireViewer();
  const db = getDb();

  // Same 72h scope as the briefing, re-scored through this sector's lens.
  const curated = db
    .select()
    .from(stories)
    .where(
      and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - 72 * 36e5))),
    )
    .orderBy(desc(stories.topScore))
    .limit(100)
    .all();

  const anchor = user ? visitAnchor(user) : null;
  const all = curated.map((story) => {
    const scores = parseDomainScores(story.domainScores);
    return {
      story,
      scores,
      score: scores?.[slug] ?? 0,
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

  const member = all.filter((c) => c.score >= DOMAIN_MEMBERSHIP_THRESHOLD);
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

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <div className="readout">
        sector scan &middot; {member.length} contacts
        {fresh > 0 && <span style={{ color: 'var(--phosphor)' }}> &middot; {fresh} new</span>}
      </div>
      <h1 className="mt-1 flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em]">
        <span aria-hidden className="inline-block h-[14px] w-[3px]" style={{ background: DOMAIN_COLORS[slug] }} />
        {DOMAIN_LABELS[slug]}
      </h1>

      <div className="mt-4">
        <SectorStrip stats={stats} active={slug} />
      </div>

      <SectionHeader label="Sector activity — 14-day sweep" />
      <ActivityTrace days={dailyDomainCounts(14)} focus={slug} />

      <SectionHeader label="Top signals" count={top.length} tone="phosphor" />
      {top.length === 0 ? (
        <p className="mono py-4 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No strong {DOMAIN_LABELS[slug]} signals in the last 72h.
        </p>
      ) : (
        <div>
          {top.map((c) => {
            const it = itemAgg.get(c.story.id) ?? { count: 0, firstUrl: null, sourceName: null };
            const vt = voteAgg.get(c.story.id) ?? { up: 0, down: 0, mine: 0 as const };
            return (
              <SignalEntry
                key={c.story.id}
                story={c.story}
                itemCount={it.count}
                firstUrl={it.firstUrl}
                sourceName={it.sourceName}
                up={vt.up}
                down={vt.down}
                myVote={vt.mine}
                isNew={c.isNew}
                highlightDomain={slug}
                readOnly={!user}
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
        <p className="readout mt-9">{lowCount} low-signal contacts below the scan threshold</p>
      )}
    </div>
  );
}

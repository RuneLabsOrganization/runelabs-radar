import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, launches, sources, stories, votes } from '@/lib/db/schema';
import { DOMAINS, DOMAIN_MEMBERSHIP_THRESHOLD, type Domain } from '@/lib/domains';
import {
  dailyDomainCounts,
  domainMomentum,
  echoStats,
  entityDailySeries,
  latestInsights,
  latestPatterns,
  topEntities,
  topicHierarchy,
  type PatternRow,
} from '@/lib/analytics';
import { seriesFor } from '@/lib/metrics';
import { isDomain } from '@/lib/domains';
import { domainAffinity, personalScore, splitFeed, timeAgo } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import { visitAnchor } from '@/lib/visits';
import { canonicalEntityKey } from '@/lib/entity';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { parseDomainScores } from '@/components/DomainChips';
import { hypeIndex } from '@/lib/science/hype';
import ChartFrame from '@/components/ChartFrame';
import ActivityPanel from '@/components/ActivityPanel';
import AnalystNotes from '@/components/AnalystNotes';
import AnomalyFeed from '@/components/AnomalyFeed';
import EntityBars from '@/components/EntityBars';
import SignalEntry from '@/components/SignalEntry';
import SignalCollage from '@/components/SignalCollage';
import MarkSeen from '@/components/MarkSeen';
import SectionHeader from '@/components/SectionHeader';
import SectorStrip, { type SectorStat } from '@/components/SectorStrip';
import ScopeHero, { type ScopeInsight } from '@/components/ScopeHero';

type ItemAgg = { count: number; firstUrl: string | null; sourceName: string | null };
type VoteAgg = { up: number; down: number; mine: 1 | -1 | 0 };

export const metadata = {
  title: 'Today',
  description:
    'Today\u2019s AI signals, curated and scored per domain — coding, copy, image, video, ads, agentic.',
};

function itemAggByStory(storyIds: number[]): Map<number, ItemAgg> {
  const map = new Map<number, ItemAgg>();
  if (storyIds.length === 0) return map;
  const db = getDb();
  const rows = db
    .select({ storyId: items.storyId, url: items.url, sourceName: sources.name })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(inArray(items.storyId, storyIds))
    .orderBy(items.id)
    .all();
  for (const row of rows) {
    if (row.storyId == null) continue;
    const agg = map.get(row.storyId) ?? { count: 0, firstUrl: null, sourceName: null };
    agg.count += 1;
    if (agg.firstUrl === null) {
      agg.firstUrl = row.url;
      agg.sourceName = row.sourceName;
    }
    map.set(row.storyId, agg);
  }
  return map;
}

function voteAggByStory(storyIds: number[], userId: number): Map<number, VoteAgg> {
  const map = new Map<number, VoteAgg>();
  if (storyIds.length === 0) return map;
  const db = getDb();
  const rows = db.select().from(votes).where(inArray(votes.storyId, storyIds)).all();
  for (const row of rows) {
    const agg = map.get(row.storyId) ?? { up: 0, down: 0, mine: 0 };
    if (row.value === 1) agg.up += 1;
    else if (row.value === -1) agg.down += 1;
    if (row.userId === userId && (row.value === 1 || row.value === -1)) agg.mine = row.value;
    map.set(row.storyId, agg);
  }
  return map;
}

type Contact = {
  story: import('@/lib/feed').Story;
  scores: Partial<Record<Domain, number>> | null;
  score: number;
  createdAt: Date;
  isNew: boolean;
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function dateLine(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default async function BriefingPage() {
  const user = await requireViewer();
  const db = getDb();
  const now = Date.now();

  const curated = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(now - 72 * 36e5))))
    .orderBy(desc(stories.topScore))
    .limit(100)
    .all();

  const rawRecent = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'raw'), gt(stories.createdAt, new Date(now - 24 * 36e5))))
    .orderBy(desc(stories.createdAt))
    .limit(30)
    .all();
  const rawCount =
    db
      .select({ c: count() })
      .from(stories)
      .where(and(eq(stories.status, 'raw'), gt(stories.createdAt, new Date(now - 24 * 36e5))))
      .get()?.c ?? 0;

  const itemAgg = itemAggByStory([...curated, ...rawRecent].map((s) => s.id));
  const voteAgg = voteAggByStory(
    curated.map((s) => s.id),
    user?.id ?? -1, // anonymous viewers match no votes
  );

  const anchor = user ? visitAnchor(user) : null;
  // personalized re-ranking: logged-in users get scores nudged by their own
  // vote history (anonymous viewers get the machine's raw ranking)
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
  const contacts = curated.map((story) => {
    const scores = parseDomainScores(story.domainScores);
    return {
      story,
      scores,
      score: personalScore(story.topScore, story.domainScores, affinity),
      createdAt: story.createdAt,
      isNew: anchor ? story.createdAt > anchor : false,
    };
  });
  const { top, scan, lowCount } = splitFeed(contacts);

  const momentum = new Map(domainMomentum().map((m) => [m.domain, m.deltaPct]));
  const chartBrand = `${getIdentity().productName} · ${new URL(config.siteUrl).host}`;
  const stats: SectorStat[] = DOMAINS.map((domain) => {
    let n = 0;
    let fresh = 0;
    for (const c of contacts) {
      if ((c.scores?.[domain] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD) {
        n += 1;
        if (c.isNew) fresh += 1;
      }
    }
    return { domain, count: n, fresh, deltaPct: momentum.get(domain) ?? null };
  });
  const freshTotal = contacts.filter((c) => c.isNew).length;

  const days = dailyDomainCounts(14);
  const entities = topEntities(8);
  const hype = new Map(hypeIndex(12).map((h) => [h.name.toLowerCase(), h.score]));
  const notes = latestInsights();
  const noticed = latestPatterns(6);
  // sector-spike patterns were detected evaluating "yesterday" — mark that day
  const spikes = noticed
    .filter((p) => p.kind === 'sector-spike' && p.subject)
    .map((p) => ({
      date: new Date(new Date(`${p.date}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10),
      domain: p.subject!,
    }));
  const topics = topicHierarchy();

  // the curve behind each claim: per-pattern 14-day series for the right rail
  const surgeSeries = entityDailySeries(
    noticed.filter((p) => p.kind === 'entity-surge' && p.subject).map((p) => p.subject!),
  );
  const trendFor = (p: PatternRow): number[] | null => {
    if (!p.subject) return null;
    if (p.kind === 'entity-surge') return surgeSeries.get(canonicalEntityKey(p.subject)) ?? null;
    if (p.kind === 'sector-spike' && isDomain(p.subject)) {
      const key = p.subject;
      return days.map((d) => d.byDomain[key]);
    }
    if (p.kind === 'price-drop') return seriesFor('aa', p.subject, 'price_blended', 14).map((x) => x.value);
    if (p.kind === 'launch-spike') return seriesFor('launches', p.subject, 'count', 14).map((x) => x.value);
    return null;
  };
  const patternTrends = noticed.map(trendFor);
  const sectorSeries = Object.fromEntries(DOMAINS.map((d) => [d, days.map((x) => x.byDomain[d])]));
  const recentLaunches = db
    .select()
    .from(launches)
    .where(gt(launches.launchedAt, new Date(now - 24 * 36e5)))
    .orderBy(desc(launches.points))
    .limit(8)
    .all();

  // feed presentation: hero (#1) → up to 4 featured → everything else folds
  // into the filterable collage, newest first
  const hero = top[0] ?? null;
  const featured = top.slice(1, 5);
  const scanAll = [...top.slice(5), ...scan].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const entryProps = (c: Contact) => {
    const it = itemAgg.get(c.story.id) ?? { count: 0, firstUrl: null, sourceName: null };
    const vt = voteAgg.get(c.story.id) ?? { up: 0, down: 0, mine: 0 as const };
    return {
      story: c.story,
      itemCount: it.count,
      firstUrl: it.firstUrl,
      sourceName: it.sourceName,
      up: vt.up,
      down: vt.down,
      myVote: vt.mine,
      isNew: c.isNew,
      timeLabel: timeAgo(c.story.createdAt),
      readOnly: !user,
    };
  };

  const collageEntries = scanAll.map((c) => {
    const it = itemAgg.get(c.story.id) ?? { count: 0, firstUrl: null, sourceName: null };
    return {
      id: c.story.id,
      title: c.story.title,
      tldr: c.story.tldr,
      score: c.score,
      createdAtMs: c.story.createdAt.getTime(),
      scores: c.scores,
      domains: DOMAINS.filter((d) => (c.scores?.[d] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD),
      firstUrl: it.firstUrl,
      sourceName: it.sourceName,
      isNew: c.isNew,
      timeLabel: timeAgo(c.story.createdAt),
    };
  });

  const notesShown = notes ? notes.items.slice(0, 2) : [];
  const noticedShown = noticed.slice(0, 3);
  const noticedTrends = patternTrends.slice(0, 3);
  const worthKnowingDate = notes?.date ?? noticed[0]?.date ?? null;

  // ── hero scope data: real contacts, counters, rotating insights ──
  const tracked24h =
    db
      .select({ c: count() })
      .from(stories)
      .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(now - 24 * 36e5))))
      .get()?.c ?? 0;
  const enabledSources =
    db.select({ c: count() }).from(sources).where(eq(sources.enabled, true)).get()?.c ?? 0;
  // plot by domain MEMBERSHIP (score >= 40), not just top-domain — otherwise
  // quiet sectors (ads, copy) render empty although stories exist. Per-domain
  // cap keeps loud sectors from flooding the scope.
  const SCOPE_PER_DOMAIN = 12;
  const scopeBlips = DOMAINS.flatMap((d) =>
    contacts
      .filter((c) => (c.scores?.[d] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD)
      .sort((a, b) => (b.scores?.[d] ?? 0) - (a.scores?.[d] ?? 0))
      .slice(0, SCOPE_PER_DOMAIN)
      .map((c) => ({
        id: c.story.id,
        title: c.story.title,
        domain: d,
        score: c.scores?.[d] ?? 0,
        isNew: c.isNew,
      })),
  );
  // rotating smart insights: analyst notes first, machine detections fill in —
  // deduped by headline, capped at 5, linked to the subject when it has one
  const scopeInsights: ScopeInsight[] = [];
  const seenHeadlines = new Set<string>();
  const pushInsight = (s: ScopeInsight) => {
    const key = s.headline.toLowerCase();
    if (seenHeadlines.has(key) || scopeInsights.length >= 5) return;
    seenHeadlines.add(key);
    scopeInsights.push(s);
  };
  for (const n of notes?.items ?? []) {
    pushInsight({
      headline: n.headline,
      detail: n.detail,
      direction: n.direction,
      href: n.domain ? `/domain/${n.domain}` : undefined,
    });
  }
  for (const p of noticed) {
    const href =
      p.kind === 'entity-surge' && p.subject
        ? `/entity/${encodeURIComponent(p.subject)}`
        : p.kind === 'sector-spike' && p.subject && isDomain(p.subject)
          ? `/domain/${p.subject}`
          : undefined;
    pushInsight({ headline: p.headline, detail: p.detail, direction: 'watch', href });
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-7">
      {user && <MarkSeen />}

      <div className="readout">{dateLine(new Date())}</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Today</h1>
      <p className="mb-5 mt-1 max-w-[640px] text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        {enabledSources} sources swept around the clock — {tracked24h} curated stories in the last 24h, scored
        against your six sectors. Strongest first; the rest filter below.
      </p>

      <ScopeHero
        blips={scopeBlips}
        kpis={[
          {
            label: 'stories tracked · 24h',
            value: tracked24h,
            series: days.map((d) => d.total),
          },
          { label: 'new since your last visit', value: freshTotal },
          { label: 'confirmed by 2+ sources · 7d', value: echoStats().multiSource },
        ]}
        insights={scopeInsights}
      />

      {/* trends: prime real estate, right under the scope */}
      <SectionHeader label="Trends — 14-day sweep" />
      <SectorStrip
        stats={stats.map((s) => ({ ...s, series: sectorSeries[s.domain] ?? null }))}
      />
      <div className="mt-5 flex flex-col gap-7 md:flex-row">
        <div className="min-w-0 flex-1">
          <ChartFrame
            title="activity — 14-day sweep"
            brand={chartBrand}
            caption={`volume = curated stories/day · sector membership ≥ 40 · as-of ${new Date().toISOString().slice(0, 10)} UTC`}
          >
            <ActivityPanel days={days} spikes={spikes} />
          </ChartFrame>
        </div>
        <div className="w-full shrink-0 md:w-[240px]">
          <div className="readout mb-2.5">most mentioned &middot; 7d</div>
          <EntityBars entities={entities} hype={hype} />
        </div>
      </div>
      {topics && topics.length > 0 && (
        <p className="mono mt-4 text-[10.5px] tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
          topic map &middot; {topics.length} categories &middot;{' '}
          <Link href="/map" className="hover:underline" style={{ color: 'var(--ink-3)' }}>
            explore the interactive map &rarr;
          </Link>
        </p>
      )}

      {/* the news leads — hero + featured top signals */}
      <SectionHeader label="Top signals" count={top.length} />
      {hero ? (
        <div>
          <div className="anim-in">
            <SignalEntry {...entryProps(hero)} hero />
          </div>
          {featured.map((c, i) => (
            <div key={c.story.id} className="anim-in" style={{ animationDelay: `${(i + 1) * 50}ms` }}>
              <SignalEntry {...entryProps(c)} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mono text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No strong signals on the scope yet — the sweep runs every 30 minutes.
        </p>
      )}

      {/* machine detections + analyst calls, one merged block (they were twins) */}
      {(noticedShown.length > 0 || notesShown.length > 0) && (
        <>
          <SectionHeader
            label={`Worth knowing — ${worthKnowingDate}`}
            tone="phosphor"
            count={noticedShown.length + notesShown.length}
          />
          {noticedShown.length > 0 && <AnomalyFeed items={noticedShown} trends={noticedTrends} />}
          {notesShown.length > 0 && <AnalystNotes items={notesShown} sectorSeries={sectorSeries} />}
        </>
      )}

      {/* everything else: the filterable collage — filters persist per user */}
      {collageEntries.length > 0 && (
        <>
          <SectionHeader label="More signals" count={scanAll.length} />
          <SignalCollage entries={collageEntries} />
        </>
      )}

      {recentLaunches.length > 0 && (
        <>
          <SectionHeader label="Launch radar — 24h" count={recentLaunches.length} />
          <ul>
            {recentLaunches.map((l) => (
              <li
                key={l.id}
                className="row-hover flex items-center gap-3 border-b border-[var(--grat-soft)] px-1 py-[7px] text-[13px] last:border-b-0"
              >
                <span className="mono w-11 shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                  {l.points ?? '—'}&#9650;
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-2)' }}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                  >
                    {l.title}
                  </a>
                </span>
                {l.category && (
                  <span className="mono hidden shrink-0 text-[10px] uppercase sm:inline" style={{ color: 'var(--ink-4)' }}>
                    {l.category}
                  </span>
                )}
                <span className="mono w-14 shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  {timeAgo(l.launchedAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <details className="mt-9">
        <summary className="readout cursor-pointer select-none">
          archive &middot; {lowCount} low-signal &middot; {rawCount} uncurated in 24h
        </summary>
        {rawRecent.length > 0 && (
          <ul className="mt-3">
            {rawRecent.map((story) => {
              const href = safeHttpUrl(itemAgg.get(story.id)?.firstUrl);
              return (
                <li
                  key={story.id}
                  className="flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[6px] text-[12.5px] last:border-b-0"
                  style={{ color: 'var(--ink-3)' }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                        {story.title}
                      </a>
                    ) : (
                      story.title
                    )}
                  </span>
                  <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                    {timeAgo(story.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </div>
  );
}

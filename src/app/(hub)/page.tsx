import { and, count, desc, eq, gt, inArray } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, sources, stories, votes } from '@/lib/db/schema';
import { DOMAINS, DOMAIN_MEMBERSHIP_THRESHOLD } from '@/lib/domains';
import {
  dailyDomainCounts,
  domainMomentum,
  echoStats,
  latestInsights,
  topEntities,
} from '@/lib/analytics';
import { splitFeed, timeAgo } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import { visitAnchor } from '@/lib/visits';
import { parseDomainScores, topDomain } from '@/components/DomainChips';
import ActivityTrace from '@/components/ActivityTrace';
import AnalystNotes from '@/components/AnalystNotes';
import EntityBars from '@/components/EntityBars';
import MarkSeen from '@/components/MarkSeen';
import ScanRow from '@/components/ScanRow';
import SectionHeader from '@/components/SectionHeader';
import SectorStrip, { type SectorStat } from '@/components/SectorStrip';
import SignalEntry from '@/components/SignalEntry';

type ItemAgg = { count: number; firstUrl: string | null; sourceName: string | null };
type VoteAgg = { up: number; down: number; mine: 1 | -1 | 0 };

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
  const contacts = curated.map((story) => {
    const scores = parseDomainScores(story.domainScores);
    return {
      story,
      scores,
      score: story.topScore,
      createdAt: story.createdAt,
      isNew: anchor ? story.createdAt > anchor : false,
    };
  });
  const { top, scan, lowCount } = splitFeed(contacts);

  const momentum = new Map(domainMomentum().map((m) => [m.domain, m.deltaPct]));
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
  const notes = latestInsights();
  const echoes = echoStats();

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      {user && <MarkSeen />}

      <div className="readout">
        {dateLine(new Date())} &middot; {contacts.length} contacts on scope
        {freshTotal > 0 && (
          <span style={{ color: 'var(--phosphor)' }}> &middot; {freshTotal} new</span>
        )}
        {echoes.multiSource > 0 && <span> &middot; {echoes.multiSource} multi-source echoes</span>}
      </div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Briefing</h1>

      <div className="mt-4">
        <SectorStrip stats={stats} />
      </div>

      <SectionHeader label="Activity — 14-day sweep" />
      <div className="flex flex-col gap-7 md:flex-row">
        <div className="min-w-0 flex-1">
          <ActivityTrace days={days} />
        </div>
        <div className="w-full shrink-0 md:w-[240px]">
          <div className="readout mb-2.5">most mentioned &middot; 7d</div>
          <EntityBars entities={entities} />
        </div>
      </div>

      {notes && notes.items.length > 0 && (
        <>
          <SectionHeader label={`Analyst notes — ${notes.date}`} />
          <AnalystNotes items={notes.items} />
        </>
      )}

      <SectionHeader label="Top signals" count={top.length} tone="phosphor" />
      {top.length === 0 ? (
        <p className="mono py-4 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No strong signals on the scope yet — curation sweeps hourly.
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
                domain={topDomain(c.scores)}
                isNew={c.isNew}
              />
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

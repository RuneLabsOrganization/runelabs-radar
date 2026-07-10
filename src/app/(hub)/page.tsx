import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, stories, votes } from '@/lib/db/schema';
import { safeHttpUrl } from '@/lib/safe-url';
import { visitAnchor } from '@/lib/visits';
import StoryCard, { timeAgo, type Story } from '@/components/StoryCard';
import MarkSeen from '@/components/MarkSeen';

type ItemAgg = { count: number; firstUrl: string | null };
type VoteAgg = { up: number; down: number; mine: 1 | -1 | 0 };

function itemAggByStory(storyIds: number[]): Map<number, ItemAgg> {
  const map = new Map<number, ItemAgg>();
  if (storyIds.length === 0) return map;
  const db = getDb();
  const rows = db
    .select({ storyId: items.storyId, url: items.url })
    .from(items)
    .where(inArray(items.storyId, storyIds))
    .orderBy(items.id)
    .all();
  for (const row of rows) {
    if (row.storyId == null) continue;
    const agg = map.get(row.storyId) ?? { count: 0, firstUrl: null };
    agg.count += 1;
    if (agg.firstUrl === null) agg.firstUrl = row.url;
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

function StoryList({
  list,
  itemAgg,
  voteAgg,
}: {
  list: Story[];
  itemAgg: Map<number, ItemAgg>;
  voteAgg: Map<number, VoteAgg>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {list.map((story) => {
        const it = itemAgg.get(story.id) ?? { count: 0, firstUrl: null };
        const vt = voteAgg.get(story.id) ?? { up: 0, down: 0, mine: 0 as const };
        return (
          <StoryCard
            key={story.id}
            story={story}
            itemCount={it.count}
            firstUrl={it.firstUrl}
            up={vt.up}
            down={vt.down}
            myVote={vt.mine}
          />
        );
      })}
    </div>
  );
}

export default async function TodayPage() {
  const user = await requireUser();
  const db = getDb();
  const now = Date.now();

  const curated = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(now - 72 * 36e5))))
    .orderBy(desc(stories.topScore))
    .limit(60)
    .all();

  const raw = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'raw'), gt(stories.createdAt, new Date(now - 24 * 36e5))))
    .orderBy(desc(stories.createdAt))
    .all();

  const itemAgg = itemAggByStory([...curated, ...raw].map((s) => s.id));
  const voteAgg = voteAggByStory(
    curated.map((s) => s.id),
    user.id,
  );

  // Stable per-visit anchor: MarkSeen advances lastSeenAt via POST /api/seen,
  // so router.refresh() after a vote re-renders against the same anchor and
  // the divider doesn't collapse mid-visit.
  const anchor = visitAnchor(user);
  const fresh = anchor ? curated.filter((s) => s.createdAt > anchor) : curated;
  const seen = anchor ? curated.filter((s) => s.createdAt <= anchor) : [];

  return (
    <div className="mx-auto max-w-[980px] px-6 py-6">
      <MarkSeen />
      <h1 className="text-lg font-bold">Today</h1>
      <p className="muted mt-0.5 text-[12px]">
        Curated stories from the last 72h, ranked by top domain score.
      </p>

      <div className="mt-5">
        {curated.length === 0 ? (
          <div className="card muted text-[13px]">
            No curated stories in the last 72 hours.
          </div>
        ) : (
          <>
            <StoryList list={fresh} itemAgg={itemAgg} voteAgg={voteAgg} />
            {fresh.length > 0 && seen.length > 0 && (
              <div
                className="my-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: 'var(--accent)' }}
              >
                <span aria-hidden className="h-px flex-1" style={{ background: 'var(--accent)', opacity: 0.4 }} />
                Since your last visit
                <span aria-hidden className="h-px flex-1" style={{ background: 'var(--accent)', opacity: 0.4 }} />
              </div>
            )}
            <StoryList list={seen} itemAgg={itemAgg} voteAgg={voteAgg} />
          </>
        )}
      </div>

      <details className="mt-8">
        <summary className="muted cursor-pointer text-[13px] select-none">
          Raw / uncurated ({raw.length})
        </summary>
        {raw.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {raw.map((story) => {
              const firstUrl = safeHttpUrl(itemAgg.get(story.id)?.firstUrl);
              return (
                <li key={story.id} className="text-[13px]">
                  {firstUrl ? (
                    <a href={firstUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {story.title}
                    </a>
                  ) : (
                    story.title
                  )}
                  <span className="muted"> &middot; {timeAgo(story.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { items, stories, votes } from '@/lib/db/schema';
import {
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  DOMAIN_MEMBERSHIP_THRESHOLD,
  isDomain,
} from '@/lib/domains';
import { parseDomainScores } from '@/components/DomainChips';
import StoryCard from '@/components/StoryCard';

export default async function DomainPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isDomain(slug)) notFound();

  const user = await requireUser();
  const db = getDb();

  // Same base list as Today: curated stories of the last 72h (top 60 by topScore),
  // then filtered to this domain and re-sorted by the domain's own score.
  const curated = db
    .select()
    .from(stories)
    .where(
      and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - 72 * 36e5))),
    )
    .orderBy(desc(stories.topScore))
    .limit(60)
    .all();

  const scored = curated
    .map((story) => ({ story, score: parseDomainScores(story.domainScores)?.[slug] ?? 0 }))
    .filter((s) => s.score >= DOMAIN_MEMBERSHIP_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const ids = scored.map((s) => s.story.id);

  const itemRows = ids.length
    ? db
        .select({ storyId: items.storyId, url: items.url })
        .from(items)
        .where(inArray(items.storyId, ids))
        .orderBy(items.id)
        .all()
    : [];
  const itemAgg = new Map<number, { count: number; firstUrl: string | null }>();
  for (const row of itemRows) {
    if (row.storyId == null) continue;
    const agg = itemAgg.get(row.storyId) ?? { count: 0, firstUrl: null };
    agg.count += 1;
    if (agg.firstUrl === null) agg.firstUrl = row.url;
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
    if (row.userId === user.id && (row.value === 1 || row.value === -1)) agg.mine = row.value;
    voteAgg.set(row.storyId, agg);
  }

  return (
    <div className="mx-auto max-w-[980px] px-6 py-6">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: DOMAIN_COLORS[slug] }}
        />
        <h1 className="text-lg font-bold">{DOMAIN_LABELS[slug]}</h1>
      </div>
      <p className="muted mt-0.5 text-[12px]">
        Curated stories from the last 72h scoring&nbsp;
        <span style={{ color: DOMAIN_COLORS[slug] }}>
          {DOMAIN_MEMBERSHIP_THRESHOLD}+
        </span>
        &nbsp;for {DOMAIN_LABELS[slug]}, highest first.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {scored.length === 0 ? (
          <div className="card muted text-[13px]">
            No {DOMAIN_LABELS[slug]} stories in the last 72 hours.
          </div>
        ) : (
          scored.map(({ story }) => {
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
                highlightDomain={slug}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

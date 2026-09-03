import { NextResponse } from 'next/server';
import { and, desc, eq, gt, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { boardHistory, stories } from '@/lib/db/schema';
import { getIdentity } from '@/lib/identity';
import { buildRss, mdToText, type RssItem } from '@/lib/rss';
import { isNoopChange } from '@/lib/board/change';
import { urls } from '@/lib/urls';

export const dynamic = 'force-dynamic';

/** Public RSS mirror of /changelog: last 30 days of top contacts + board moves. */
export async function GET() {
  const id = getIdentity();
  const db = getDb();
  const cutoff = new Date(Date.now() - 30 * 24 * 36e5);

  // window + score floor live in SQL so the stories_status_created index does
  // the filtering — not a full-table scan with a JS filter on top
  const curated = db
    .select()
    .from(stories)
    .where(
      and(eq(stories.status, 'curated'), gt(stories.createdAt, cutoff), gte(stories.topScore, 40)),
    )
    .orderBy(desc(stories.createdAt))
    .all();

  const moves = db
    .select()
    .from(boardHistory)
    .where(gt(boardHistory.appliedAt, cutoff))
    .orderBy(desc(boardHistory.appliedAt))
    .all()
    // consistency with /changelog: "no field changes" rows are noise, not changelog
    .filter((h) => !isNoopChange(h.change));

  const items: RssItem[] = [
    ...moves.map((h) => ({
      title: `Board move — ${h.domain}/${h.task}: ${h.change}`,
      link: urls.changelog(),
      date: h.appliedAt,
      guid: `board-${h.id}`,
    })),
    ...curated.map((s) => ({
      title: s.title,
      link: urls.story(s.id),
      date: s.createdAt,
      description: s.tldr ? mdToText(s.tldr) : undefined,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 100);

  const xml = buildRss({
    title: `${id.productName} — Changelog`,
    link: urls.changelog(),
    description: 'New evaluations, board moves and stack updates — every day the machine sweeps.',
    items,
  });

  return new NextResponse(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

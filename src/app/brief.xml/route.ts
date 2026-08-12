import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { briefs } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { buildRss, mdToText } from '@/lib/rss';

export const dynamic = 'force-dynamic';

/** Public RSS feed of the daily brief — last 14 editions. */
export async function GET() {
  const base = config.siteUrl;
  const id = getIdentity();

  const recent = getDb().select().from(briefs).orderBy(desc(briefs.date)).limit(14).all();

  const xml = buildRss({
    title: `${id.briefTitle}`,
    link: `${base}/brief`,
    description: 'The daily machine-written brief: what happened, why it matters, board changes.',
    items: recent.map((b) => ({
      title: `${id.briefTitle} — ${b.date}`,
      link: `${base}/brief`,
      date: b.createdAt,
      guid: `brief-${b.date}`,
      description: mdToText(b.markdown),
    })),
  });

  return new NextResponse(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}

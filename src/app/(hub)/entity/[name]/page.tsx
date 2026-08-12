import { notFound } from 'next/navigation';
import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { metricPoints, stories } from '@/lib/db/schema';
import { entityDailySeries } from '@/lib/analytics';
import { hypeIndex } from '@/lib/science/hype';
import { timeAgo } from '@/lib/feed';
import { getIdentity } from '@/lib/identity';
import { resolveEntity } from '@/lib/entity';
import MiniTrend from '@/components/MiniTrend';

interface EntityRow {
  name: string;
  kind: string;
  mentions: number;
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const entity = resolveEntity(decodeURIComponent(name));
  if (!entity) return {};
  return {
    title: `${entity.name} — watch`,
    description: `${entity.mentions} mentions tracked · hype/substance, velocity metrics and every story about ${entity.name} on ${getIdentity().productName}.`,
  };
}

/**
 * Entity watch page — everything the scope knows about one model/tool/org:
 * mention trend, velocity metrics (stars/downloads), hype-vs-substance,
 * and every curated story mentioning it. Auto-generated = SEO surface.
 */
export default async function EntityPage({ params }: { params: Promise<{ name: string }> }) {
  await requireViewer();
  const { name } = await params;
  const entity = resolveEntity(decodeURIComponent(name));
  if (!entity) notFound();

  const db = getDb();
  const needle = entity.name.toLowerCase();

  const series = entityDailySeries([entity.name], 14).get(needle) ?? [];
  const hype = hypeIndex(25).find((h) => h.name.toLowerCase() === needle);

  // velocity metrics for series whose entity contains the name (github/hf/npm)
  const metrics = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      value: metricPoints.value,
      date: metricPoints.date,
    })
    .from(metricPoints)
    .where(sql`lower(${metricPoints.entity}) LIKE ${'%' + needle + '%'}`)
    .orderBy(desc(metricPoints.date))
    .limit(300)
    .all();
  const latestMetric = new Map<string, { value: number; date: string }>();
  for (const m of metrics) {
    const key = `${m.source}:${m.entity}:${m.metric}`;
    if (!latestMetric.has(key)) latestMetric.set(key, { value: m.value, date: m.date });
  }

  const related = db
    .select({
      id: stories.id,
      title: stories.title,
      topScore: stories.topScore,
      createdAt: stories.createdAt,
    })
    .from(stories)
    .where(
      sql`${stories.status} = 'curated' AND EXISTS (
        SELECT 1 FROM json_each(${stories.entities}) e WHERE lower(e.value->>'name') = ${needle}
      )`,
    )
    .orderBy(desc(stories.createdAt))
    .limit(20)
    .all();

  const hypeColor =
    hype === undefined ? 'var(--ink-4)' : hype.score > 70 ? 'var(--amber)' : hype.score < 30 ? 'var(--phosphor)' : 'var(--ink-3)';

  return (
    <>
      <p className="readout">entity watch</p>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{entity.name}</h1>
      <div className="mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
        <span>{entity.kind}</span>
        <span>{entity.mentions} mentions tracked</span>
        {hype && (
          <span style={{ color: hypeColor }} title="hype vs substance — high = loud, low = shipping">
            H/S {hype.score}
          </span>
        )}
      </div>

      {series.length > 0 && (
        <div className="mt-5">
          <div className="readout mb-2">mentions &middot; 14d</div>
          <MiniTrend values={series} width={280} height={56} />
        </div>
      )}

      {latestMetric.size > 0 && (
        <div className="mt-6">
          <div className="readout mb-2">velocity &middot; latest</div>
          <div className="flex flex-col gap-1">
            {[...latestMetric.entries()].slice(0, 8).map(([key, v]) => (
              <div key={key} className="mono flex items-baseline justify-between gap-3 text-[11px]">
                <span className="min-w-0 truncate" style={{ color: 'var(--ink-3)' }}>
                  {key}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: 'var(--ink-2)' }}>
                  {v.value.toLocaleString('en-US')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-7">
        <div className="readout mb-2">stories &middot; {related.length}</div>
        <div className="flex flex-col">
          {related.map((s) => (
            <Link
              key={s.id}
              href={`/story/${s.id}`}
              className="row-hover -mx-2 flex items-baseline gap-2.5 rounded-[3px] px-2 py-[7px]"
            >
              <span className="mono shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--ink-4)' }}>
                {timeAgo(s.createdAt)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--ink-2)' }}>
                {s.title}
              </span>
              <span className="mono shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--ink-3)' }}>
                {s.topScore}
              </span>
            </Link>
          ))}
          {related.length === 0 && (
            <p className="muted text-[13px]">No curated stories mention this entity yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

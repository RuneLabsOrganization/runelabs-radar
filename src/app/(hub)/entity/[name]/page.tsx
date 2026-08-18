import { notFound } from 'next/navigation';
import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { config } from '@/lib/config';
import { getDb } from '@/lib/db';
import { metricPoints, stories } from '@/lib/db/schema';
import { entityDailySeries } from '@/lib/analytics';
import { hypeIndex } from '@/lib/science/hype';
import { timeAgo } from '@/lib/feed';
import { getIdentity } from '@/lib/identity';
import { resolveEntity, canonicalEntityKey } from '@/lib/entity';
import {
  boardPlacements,
  coMentioned,
  humanizeMetricKey,
  metricWeeklyDelta,
  weeklyDelta,
  type Delta,
} from '@/lib/entity-extras';
import MiniTrend from '@/components/MiniTrend';
import { DOMAIN_LABELS, isDomain } from '@/lib/domains';

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const entity = resolveEntity(decodeURIComponent(name));
  if (!entity) return {};
  return {
    title: `${entity.name} — watch`,
    description: `${entity.mentions} mentions tracked · hype/substance, velocity metrics and every story about ${entity.name} on ${getIdentity().productName}.`,
  };
}

function fmtNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

/** Stake/Yahoo delta chip: arrow + abs + % + range label, direction-colored. */
function DeltaChip({ delta, range }: { delta: Delta; range: string }) {
  if (delta.abs === 0) {
    return (
      <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
        → flat · {range}
      </span>
    );
  }
  const up = delta.abs > 0;
  return (
    <span className="mono text-[10.5px]" style={{ color: up ? 'var(--phosphor)' : 'var(--alert)' }}>
      {up ? '↗' : '↘'} {up ? '+' : '−'}
      {fmtNum(Math.abs(delta.abs))}
      {delta.pct !== null && ` (${up ? '+' : '−'}${Math.abs(delta.pct)}%)`} · {range}
    </span>
  );
}

function StatBlock({ label, value, delta, range }: { label: string; value: string; delta?: Delta; range?: string }) {
  return (
    <div>
      <div className="mono text-[22px] font-light leading-none tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
      <div className="mono mt-1.5 text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--ink-4)' }}>
        {label}
      </div>
      {delta && (
        <div className="mt-1">
          <DeltaChip delta={delta} range={range ?? '7d'} />
        </div>
      )}
    </div>
  );
}

/**
 * Entity watch page — everything the scope knows about one model/tool/org:
 * what it's best FOR (board placements), mention trend, velocity deltas,
 * hype-vs-substance, the co-mentioned graph, and every curated story about it.
 */
export default async function EntityPage({ params }: { params: Promise<{ name: string }> }) {
  await requireViewer();
  const { name } = await params;
  const entity = resolveEntity(decodeURIComponent(name));
  if (!entity) notFound();

  const db = getDb();
  const needle = entity.name.toLowerCase();

  const series = entityDailySeries([entity.name], 14).get(canonicalEntityKey(entity.name)) ?? [];
  const mentionsWeek = weeklyDelta(series);
  const hype = hypeIndex(25).find((h) => h.name.toLowerCase() === needle);

  // velocity metrics: per-series latest + 7d delta
  const metricRows = db
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
  const perSeries = new Map<string, { date: string; value: number }[]>();
  for (const m of metricRows) {
    const key = `${m.source}:${m.entity}:${m.metric}`;
    const list = perSeries.get(key) ?? [];
    list.push({ date: m.date, value: m.value });
    perSeries.set(key, list);
  }
  const velocity = [...perSeries.entries()]
    .map(([key, points]) => ({ key, delta: metricWeeklyDelta(points) }))
    .filter((v): v is { key: string; delta: Delta } => v.delta !== null)
    .sort((a, b) => b.delta.current - a.delta.current);

  const placements = boardPlacements(entity.name);
  const related = coMentioned(entity.name, 6);

  const storyRows = db
    .select({
      id: stories.id,
      title: stories.title,
      topScore: stories.topScore,
      createdAt: stories.createdAt,
    })
    .from(stories)
    .where(
      // canonical-key match in SQL: strip the separators canonicalEntityKey strips,
      // so "GPT 5" / "GPT-5" variants of the entity all match
      sql`${stories.status} = 'curated' AND EXISTS (
        SELECT 1 FROM json_each(${stories.entities}) e
        WHERE replace(replace(replace(replace(replace(lower(e.value->>'name'),' ',''),'-',''),'.',''),'_',''),'/','') = ${canonicalEntityKey(entity.name)}
      )`,
    )
    .orderBy(desc(stories.createdAt))
    .limit(20)
    .all();

  const hypeChip =
    hype === undefined ? null : hype.score > 70 ? (
      <span className="mono rounded-[3px] border border-[var(--grat)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em]" style={{ color: 'var(--amber)' }}>
        hype {hype.score}
      </span>
    ) : hype.score < 30 ? (
      <span className="mono rounded-[3px] border border-[var(--grat)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em]" style={{ color: 'var(--phosphor)' }}>
        substance {hype.score}
      </span>
    ) : (
      <span className="mono rounded-[3px] border border-[var(--grat-soft)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-3)' }}>
        H/S {hype.score}
      </span>
    );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': entity.kind === 'org' ? 'Organization' : 'SoftwareApplication',
    name: entity.name,
    url: `${config.siteUrl}/entity/${encodeURIComponent(name)}`,
    description: `${entity.name} tracked across ${entity.mentions} curated AI stories — hype/substance, velocity metrics, board placements on ${getIdentity().productName}.`,
  };

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mono flex items-center gap-2.5 text-[10.5px] uppercase tracking-[0.08em]">
        <span className="readout">entity watch</span>
        <span style={{ color: 'var(--ink-4)' }}>·</span>
        <span style={{ color: 'var(--ink-4)' }}>{entity.kind}</span>
        {hypeChip}
      </div>
      <h1 className="mt-1 text-[21px] font-semibold tracking-[-0.01em]">{entity.name}</h1>
      <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Everything the radar tracks on {entity.name} — mentions, velocity, board placements, and the stories
        behind them.
      </p>

      {/* the Stake stat row: big numbers + range-labeled delta chips */}
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-5">
        <StatBlock label="mentions · 7d" value={fmtNum(mentionsWeek.current)} delta={mentionsWeek} />
        {velocity.slice(0, 3).map((v) => (
          <StatBlock
            key={v.key}
            label={humanizeMetricKey(v.key)}
            value={fmtNum(v.delta.current)}
            delta={v.delta}
          />
        ))}
      </div>
      {hype && (
        <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
          hype vs substance — high is loud, low is shipping (mentions vs github/hf/npm artifacts, 7d)
        </p>
      )}

      {series.length > 0 && (
        <div className="mt-5">
          <div className="readout mb-2">mentions &middot; 14d</div>
          <MiniTrend values={series} width={280} height={56} />
        </div>
      )}

      {placements.length > 0 && (
        <div className="mt-7">
          <div className="readout mb-2">on the board &middot; what it&rsquo;s best for</div>
          <ul>
            {placements.map((p, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0">
                <span className="mono shrink-0 text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
                  {isDomain(p.domain) ? DOMAIN_LABELS[p.domain] : p.domain} / {p.task}
                </span>
                <Link href="/board" className="min-w-0 flex-1 hover:underline" style={{ color: 'var(--ink-2)' }}>
                  {p.role}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {velocity.length > 3 && (
        <div className="mt-6">
          <div className="readout mb-2">velocity &middot; latest + 7d</div>
          <div className="flex flex-col gap-1.5">
            {velocity.slice(3, 10).map((v) => (
              <div key={v.key} className="flex items-baseline justify-between gap-3">
                <span className="mono min-w-0 truncate text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  {humanizeMetricKey(v.key)}
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="mono tabular-nums text-[11px]" style={{ color: 'var(--ink-2)' }}>
                    {v.delta.current.toLocaleString('en-US')}
                  </span>
                  <DeltaChip delta={v.delta} range="7d" />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-7">
          <div className="readout mb-2">often mentioned with</div>
          <div className="flex flex-wrap gap-1.5">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/entity/${r.slug}`}
                className="mono rounded-[3px] border border-[var(--grat-soft)] px-2 py-1 text-[10.5px] transition-colors hover:border-[var(--grat-strong)]"
                style={{ color: 'var(--ink-3)' }}
              >
                {r.name} <span style={{ color: 'var(--ink-4)' }}>{r.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-7">
        <div className="readout mb-2">stories &middot; {storyRows.length}</div>
        <div className="flex flex-col">
          {storyRows.map((s) => (
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
          {storyRows.length === 0 && (
            <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>No curated stories mention this entity yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

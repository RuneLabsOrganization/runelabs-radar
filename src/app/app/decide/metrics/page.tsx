import { asc, notLike, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { metricPoints } from '@/lib/db/schema';
import { requireViewer } from '@/lib/auth/user';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { seriesFor } from '@/lib/metrics';
import ChartFrame from '@/components/ChartFrame';
import MetricsExplorer, { type ExplorerSeries, type MetricKey } from '@/components/MetricsExplorer';
import { Card, CardContent } from '@/components/ui/card';
import { WorkspaceNav } from '@/components/app/WorkspaceNav';

export const metadata = {
  title: 'Metrics — explorer',
  description:
    'Chart and compare any tracked metric series — model prices, benchmark scores, GitHub stars, package downloads — with CSV/PNG export and a daily public dataset dump.',
};

// mirrors MetricsExplorer.tsx (a server component can't import runtime
// values from a client module — keep both copies in sync)
const MAX_SERIES = 6;
const DAY_OPTIONS = [30, 90, 180, 365];

function encodeKey(k: { source: string; entity: string; metric: string }): string {
  return [k.source, k.entity, k.metric].map(encodeURIComponent).join(':');
}

function decodeKey(s: string): { source: string; entity: string; metric: string } | null {
  const parts = s.split(':');
  if (parts.length !== 3) return null;
  try {
    return { source: decodeURIComponent(parts[0]), entity: decodeURIComponent(parts[1]), metric: decodeURIComponent(parts[2]) };
  } catch {
    return null;
  }
}

const COLORS = ['var(--phosphor)', 'var(--amber)', 'var(--d-image)', 'var(--d-coding)', 'var(--alert)', 'var(--d-agentic)'];

function fmtVal(v: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

/**
 * Multi-series overlay. One series: true values on the y-axis. More than
 * one: each series min-max scaled to its own range (shapes are comparable,
 * absolute values are not — said so under the chart).
 */
function OverlayChart({ series }: { series: ExplorerSeries[] }) {
  const W = 640;
  const H = 240;
  const PAD = { top: 12, right: 14, bottom: 24, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  if (dates.length === 0) {
    return (
      <p className="mono py-3 text-[12px] text-ink-4">
        No points in this range — widen the window or pick another series.
      </p>
    );
  }
  const t0 = Date.parse(dates[0]);
  const t1 = Math.max(Date.parse(dates[dates.length - 1]), t0 + 864e5);
  const normalize = series.length > 1;
  const scales = series.map((s) => {
    const vals = s.points.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, span: max - min };
  });
  const yMax = normalize ? 1 : Math.max(...series[0].points.map((p) => p.value), 0.001) * 1.15;

  const x = (date: string) => PAD.left + ((Date.parse(date) - t0) / (t1 - t0)) * plotW;
  const yFor = (i: number) => (v: number) => {
    if (normalize) {
      const { min, span } = scales[i];
      const frac = span === 0 ? 0.5 : (v - min) / span;
      return PAD.top + (1 - frac) * plotH;
    }
    return PAD.top + plotH - (v / yMax) * plotH;
  };

  const yTicks: { at: number; label: string }[] = normalize
    ? [
        { at: 0, label: 'min' },
        { at: 0.5, label: '' },
        { at: 1, label: 'max' },
      ]
    : [
        { at: 0, label: '0' },
        { at: yMax / 2, label: fmtVal(yMax / 2) },
        { at: yMax, label: fmtVal(yMax) },
      ];
  const yTick = (t: number) => (normalize ? PAD.top + (1 - t) * plotH : PAD.top + plotH - (t / yMax) * plotH);

  return (
    <div>
      {/* legend */}
      <div className="mono mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
        {series.map((s, i) => (
          <span key={`${s.source}/${s.entity}/${s.metric}`} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-[2px]" style={{ background: COLORS[i % COLORS.length] }} />
            {s.entity} · {s.metric}
            <span className="text-ink-4">
              {s.points.length > 0 ? `last ${fmtVal(s.points[s.points.length - 1].value)}` : 'no points'}
            </span>
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Overlay of ${series.map((s) => `${s.entity} ${s.metric}`).join(', ')}`}
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yTick(t.at)} y2={yTick(t.at)} stroke="var(--grat-soft)" />
            {t.label && (
              <text x={PAD.left - 5} y={yTick(t.at) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
                {t.label}
              </text>
            )}
          </g>
        ))}
        {[dates[0], dates[dates.length - 1]].map((d, i) => (
          <text
            key={`${d}-${i}`}
            x={x(d)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : 'end'}
            fontSize={10}
            fill="var(--ink-4)"
            fontFamily="var(--font-readout)"
          >
            {d.slice(5)}
          </text>
        ))}
        {series.map((s, i) =>
          s.points.length > 1 ? (
            <polyline
              key={`${s.source}/${s.entity}/${s.metric}`}
              points={s.points.map((p) => `${x(p.date)},${yFor(i)(p.value)}`).join(' ')}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={1.5}
            />
          ) : (
            s.points.map((p) => (
              <circle key={`${s.source}/${s.entity}/${s.metric}/${p.date}`} cx={x(p.date)} cy={yFor(i)(p.value)} r={3} fill={COLORS[i % COLORS.length]} />
            ))
          ),
        )}
      </svg>
    </div>
  );
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[]; days?: string }>;
}) {
  const user = await requireViewer();
  // AA-derived series are gated for anonymous visitors: republication
  // requires a redistribution agreement with Artificial Analysis (see
  // config.aaPublic) — same rule as the board page.
  const showAA = !!user || config.aaPublic;
  const { s, days: daysRaw } = await searchParams;

  const db = getDb();
  // same enumeration as the MCP list_metrics tool (mcp/tools/market.ts)
  const keys: MetricKey[] = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      latest: sql<string>`max(${metricPoints.date})`,
      points: sql<number>`count(*)`,
    })
    .from(metricPoints)
    .where(showAA ? undefined : notLike(metricPoints.source, 'aa%'))
    .groupBy(metricPoints.source, metricPoints.entity, metricPoints.metric)
    .orderBy(asc(metricPoints.source), asc(metricPoints.entity), asc(metricPoints.metric))
    .limit(1000)
    .all();

  const valid = new Set(keys.map(encodeKey));
  const requested = (Array.isArray(s) ? s : s ? [s] : []).map(decodeKey).filter((k): k is NonNullable<typeof k> => k !== null);
  const active: { source: string; entity: string; metric: string }[] = [];
  const seen = new Set<string>();
  for (const k of requested) {
    const enc = encodeKey(k);
    if (!valid.has(enc) || seen.has(enc) || active.length >= MAX_SERIES) continue;
    seen.add(enc);
    active.push(k);
  }

  const days = DAY_OPTIONS.includes(Number(daysRaw)) ? Number(daysRaw) : 90;
  const series: ExplorerSeries[] = active.map((k) => ({ ...k, points: seriesFor(k.source, k.entity, k.metric, days) }));

  const chartBrand = `${getIdentity().productName} · ${new URL(config.siteUrl).host}`;
  const chartTitle =
    series.length === 0
      ? 'metrics'
      : series
          .map((sr) => `${sr.entity} ${sr.metric}`)
          .join(' vs ')
          .slice(0, 80);
  const caption =
    series.length > 1
      ? `each series scaled to its own min–max range — compare shapes, not absolute values · ${days}d window`
      : series.length === 1
        ? `${series[0].source}/${series[0].entity}/${series[0].metric} · ${days}d window`
        : undefined;

  return (
    <div>
      <WorkspaceNav section="decide" />
      <div className="readout text-phosphor">Decide · Metrics</div>
      <h1 className="type-h1 mt-1">Metrics</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
        Chart and compare any series in the metrics store — model prices, benchmark scores, GitHub stars, package
        downloads. Export the view as CSV or PNG, or pull the full daily dataset below.
      </p>

      {keys.length === 0 ? (
        <Card className="mt-5">
          <CardContent className="p-5">
            <p className="mono text-[12px] text-ink-4">
              No metric series tracked yet — the ingest jobs begin the store.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <MetricsExplorer keys={keys} active={active} days={days} series={series} />
          {series.length > 0 ? (
            <Card className="mt-4">
              <CardContent className="p-4">
                <ChartFrame title={chartTitle} brand={chartBrand} caption={caption}>
                  <OverlayChart series={series} />
                </ChartFrame>
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-4">
              <CardContent className="p-4">
                <p className="mono py-2 text-[12px] text-ink-4">
                  Pick a source, entity, and metric above — add up to {MAX_SERIES} series to overlay.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <p className="mono mt-4 text-[10.5px] leading-relaxed text-ink-4">
        databook: every first-party series, refreshed daily —{' '}
        <a href="/api/dataset" className="underline transition-colors hover:text-ink-2">
          /api/dataset
        </a>{' '}
        (jsonl.gz, one {'{source,entity,metric,date,value}'} per line).
        {!showAA && (
          <> Artificial Analysis-derived series are withheld from the public dataset and explorer (republication terms); sign in to see them.</>
        )}
      </p>
    </div>
  );
}

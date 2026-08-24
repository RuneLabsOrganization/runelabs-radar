import Link from 'next/link';
import { asc, notLike, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { metricPoints } from '@/lib/db/schema';
import { requireViewer } from '@/lib/auth/user';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { seriesFor, utcDay } from '@/lib/metrics';
import { AGENT_PLANS } from '@/lib/agent-plans';
import {
  aaPricePressure,
  hottestLaunchCategory,
  launchHeatSeries,
  marketMovers,
  pulseAnomaly,
  resolvePulsePresets,
  risingWatchlist,
} from '@/lib/pulse';
import { paths } from '@/lib/urls';
import ChartFrame from '@/components/ChartFrame';
import MetricsExplorer, { type ExplorerSeries, type MetricKey } from '@/components/MetricsExplorer';
import OverlayChart from '@/components/OverlayChart';
import SectionHeader from '@/components/SectionHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Pulse — builder market',
  description:
    'What’s moving in the builder market: launch heat, rising adoption, agent plan prices — plus a free-form metrics explorer.',
};

const MAX_SERIES = 8;
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

function fmtVal(v: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const s = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  return `${pct > 0 ? '+' : ''}${s}%`;
}

function explorerHref(keys: { source: string; entity: string; metric: string }[]): string {
  const p = new URLSearchParams();
  for (const k of keys.slice(0, MAX_SERIES)) p.append('s', encodeKey(k));
  const q = p.toString();
  return q ? `${paths.metrics}?${q}` : paths.metrics;
}

function PulseTile({
  label,
  value,
  delta,
  detail,
  href,
}: {
  label: string;
  value: string;
  delta?: string | null;
  detail: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="mono text-[10px] tracking-[0.08em] text-ink-4">{label}</span>
      <span className="mono mt-1 flex items-baseline gap-1.5 text-[20px] font-light leading-none tracking-[-0.02em] text-ink">
        {value}
        {delta != null && delta !== '—' && (
          <span className={`text-[11px] ${delta.startsWith('+') ? 'text-phosphor' : delta.startsWith('-') ? 'text-alert' : 'text-ink-4'}`}>
            {delta}
          </span>
        )}
      </span>
      <span className="mt-1.5 block text-[12px] leading-snug text-ink-3">{detail}</span>
    </>
  );
  const cls =
    'hover-raise block rounded-[5px] border border-grat-soft bg-scope-1 px-3 py-2.5 transition-colors hover:border-grat';
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[]; days?: string }>;
}) {
  const user = await requireViewer();
  const showAA = !!user || config.aaPublic;
  const { s, days: daysRaw } = await searchParams;

  const db = getDb();
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

  const sinceDay = utcDay(new Date(Date.now() - 7 * 864e5));
  const hottest = hottestLaunchCategory(7);
  const movers = marketMovers(sinceDay, 8);
  const topMover = movers[0] ?? null;
  const cost = showAA ? aaPricePressure() : null;
  const watchlist = risingWatchlist(5);
  const anomaly = pulseAnomaly(showAA);
  const heroSeries = launchHeatSeries(90);
  const presets = resolvePulsePresets(showAA);
  const plans = [...AGENT_PLANS].sort((a, b) => a.priceUsdMo - b.priceUsdMo);
  const planMax = Math.max(...plans.map((p) => p.priceUsdMo), 1);

  const chartBrand = `${getIdentity().productName} · ${new URL(config.siteUrl).host}`;
  const heroCaption =
    hottest && hottest.total > 0
      ? `${hottest.category} leads launch volume this week (${hottest.total}) · shapes normalized · 90d`
      : 'launch counts by category · shapes normalized · 90d';

  const explorerCaption =
    series.length > 1
      ? `each series scaled to its own min–max range — compare shapes, not absolute values · ${days}d window`
      : series.length === 1
        ? `${series[0].source}/${series[0].entity}/${series[0].metric} · ${days}d window`
        : undefined;
  const explorerTitle =
    series.length === 0
      ? 'metrics'
      : series
          .map((sr) => `${sr.entity} ${sr.metric}`)
          .join(' vs ')
          .slice(0, 80);

  const loginHref = `${paths.login}?next=${encodeURIComponent(paths.metrics)}`;

  return (
    <div>
      <div className="readout text-phosphor">Decide · Pulse</div>
      <h1 className="type-h1 mt-1">Pulse</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
        What’s moving in the builder market — launch heat, rising adoption, plan prices. Explore any series below.
      </p>

      {/* Headline strip */}
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <PulseTile
          label="HOTTEST LAUNCHES"
          value={hottest && hottest.total > 0 ? hottest.category : 'quiet'}
          delta={hottest && hottest.total > 0 ? fmtPct(hottest.pct) : null}
          detail={
            hottest && hottest.total > 0
              ? `${hottest.total} launches in 7d${hottest.prevTotal > 0 ? ` vs ${hottest.prevTotal} prior` : ''}`
              : 'No launches recorded in the last week.'
          }
          href={explorerHref([{ source: 'launches', entity: hottest?.category ?? 'ai-coding', metric: 'count' }])}
        />
        <PulseTile
          label="BIGGEST MOVER"
          value={topMover ? topMover.entity.split('/').pop() ?? topMover.entity : 'steady'}
          delta={topMover ? fmtPct(topMover.pct) : null}
          detail={
            topMover
              ? `${topMover.source} · ${topMover.metric} · ${fmtVal(topMover.from)} → ${fmtVal(topMover.to)}`
              : 'No first-party series moved ≥10% this week.'
          }
          href={topMover ? explorerHref([topMover]) : undefined}
        />
        {showAA && cost ? (
          <PulseTile
            label="COST PRESSURE"
            value={cost.entity}
            delta={fmtPct(cost.pct)}
            detail={`blended price ${fmtVal(cost.from)} → ${fmtVal(cost.to)} · 7d`}
            href={explorerHref([cost])}
          />
        ) : showAA ? (
          <PulseTile label="COST PRESSURE" value="flat" detail="No material AA price moves in the last 7 days." />
        ) : (
          <Link
            href={loginHref}
            className="hover-raise block rounded-[5px] border border-dashed border-grat bg-scope-1 px-3 py-2.5 transition-colors hover:border-phosphor"
          >
            <span className="mono text-[10px] tracking-[0.08em] text-ink-4">COST PRESSURE</span>
            <span className="mono mt-1 block text-[15px] text-ink-2">Sign in for model prices</span>
            <span className="mt-1.5 block text-[12px] leading-snug text-ink-3">
              AA blended-price movers unlock when you’re signed in.
            </span>
          </Link>
        )}
      </div>

      {/* Hero — launch heat */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <ChartFrame title="Launch heat by category" brand={chartBrand} caption={heroCaption}>
            {heroSeries.length > 0 ? (
              <OverlayChart series={heroSeries} />
            ) : (
              <p className="mono py-3 text-[12px] text-ink-4">Launch series will appear once the daily launch job runs.</p>
            )}
          </ChartFrame>
        </CardContent>
      </Card>

      {/* Insight cards */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Agent plan ladder</CardTitle>
            <CardDescription>List prices — coding-agent subscriptions.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <ul className="space-y-1.5">
              {plans.map((p) => (
                <li key={`${p.vendor}-${p.name}`} className="flex items-center gap-2">
                  <span className="mono w-[4.5rem] shrink-0 text-[11px] text-ink-3">
                    {p.priceUsdMo === 0 ? 'free' : `$${p.priceUsdMo}`}
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 rounded-[2px] bg-scope-2">
                    <span
                      className="block h-full rounded-[2px] bg-phosphor/70"
                      style={{ width: `${Math.max(4, (p.priceUsdMo / planMax) * 100)}%` }}
                    />
                  </span>
                  <span className="mono max-w-[40%] truncate text-[11px] text-ink-2" title={`${p.vendor} ${p.name}`}>
                    {p.vendor} {p.name}
                  </span>
                </li>
              ))}
            </ul>
            <Link href={paths.agents} className="mono mt-3 inline-block text-[11px] text-phosphor transition-colors hover:text-ink-2">
              Full comparison →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Rising watchlist</CardTitle>
            <CardDescription>First-party series with the largest weekly moves.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {watchlist.length === 0 ? (
              <p className="mono text-[12px] text-ink-4">No movers above the 10% noise floor this week.</p>
            ) : (
              <ul className="space-y-2">
                {watchlist.map((m) => (
                  <li key={`${m.source}/${m.entity}/${m.metric}`}>
                    <Link
                      href={explorerHref([m])}
                      className="flex items-baseline justify-between gap-2 transition-colors hover:text-phosphor"
                    >
                      <span className="min-w-0 truncate text-[12.5px] text-ink-2">
                        <span className="mono text-[10px] text-ink-4">{m.source}</span>{' '}
                        {m.entity} · {m.metric}
                      </span>
                      <span className={`mono shrink-0 text-[11px] ${m.pct >= 0 ? 'text-phosphor' : 'text-alert'}`}>
                        {fmtPct(m.pct)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Worth watching</CardTitle>
            <CardDescription>Latest first-party anomaly from the pattern detector.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {anomaly ? (
              <>
                <p className="mono text-[10px] tracking-[0.06em] text-ink-4">{anomaly.kind}</p>
                <p className="mt-1 text-[13.5px] font-medium leading-snug text-ink">{anomaly.headline}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{anomaly.detail}</p>
              </>
            ) : (
              <p className="mono text-[12px] text-ink-4">No launch or sector spikes on the latest scan — quiet tape.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Explorer */}
      <div className="mt-8">
        <SectionHeader label="Build your own view" />
        <p className="mt-1 max-w-xl text-[12.5px] text-ink-3">
          Overlay up to {MAX_SERIES} series. Presets jump-start a view; pick source → entity → metric for anything else.
        </p>
        {keys.length === 0 ? (
          <Card className="mt-4">
            <CardContent className="p-5">
              <p className="mono text-[12px] text-ink-4">No metric series tracked yet — the ingest jobs begin the store.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <MetricsExplorer
              keys={keys}
              active={active}
              days={days}
              series={series}
              presets={presets.map((p) => ({ id: p.id, label: p.label, keys: p.keys }))}
            />
            {series.length > 0 ? (
              <Card className="mt-4">
                <CardContent className="p-4">
                  <ChartFrame title={explorerTitle} brand={chartBrand} caption={explorerCaption}>
                    <OverlayChart series={series} />
                  </ChartFrame>
                </CardContent>
              </Card>
            ) : (
              <Card className="mt-4">
                <CardContent className="p-4">
                  <p className="mono py-2 text-[12px] text-ink-4">
                    Pick a preset or add a series above — up to {MAX_SERIES} overlays.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

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

import { desc, gte } from 'drizzle-orm';
import type { ReactNode } from 'react';
import BoardNav from '@/components/BoardNav';
import CostMatrix from '@/components/CostMatrix';
import EloBars from '@/components/EloBars';
import FrontierTimeline from '@/components/FrontierTimeline';
import ModelScatter from '@/components/ModelScatter';
import TaskCostExplorer from '@/components/TaskCostExplorer';
import ValueBars from '@/components/ValueBars';
import VerdictEditor from '@/components/VerdictEditor';
import SectionHeader from '@/components/SectionHeader';
import PageHeader from '@/components/PageHeader';
import { aaMedia, aaModels } from '@/lib/analytics';
import { seriesFor } from '@/lib/metrics';
import { forecastFrontierPrice } from '@/lib/science/forecast';
import { lagFindings, lagReadiness } from '@/lib/science/lag';
import ForecastChart from '@/components/ForecastChart';
import LagPanel from '@/components/LagPanel';
import { requireViewer } from '@/lib/auth/user';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { formatBoardChange, isNoopChange } from '@/lib/board/change';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { boardEntries, boardHistory } from '@/lib/db/schema';
import { DOMAIN_COLORS, DOMAIN_LABELS, DOMAINS, isDomain } from '@/lib/domains';
import ChartFrame from '@/components/ChartFrame';

type BoardEntry = typeof boardEntries.$inferSelect;

export const metadata = {
  title: 'Best Right Now — cost-benefit board',
  description:
    'The best AI model/tool for each task right now: best overall, best value, cheapest viable, with verdicts — synced weekly from benchmarks and the news.',
};

/** Cost notes are ';'-separated per-model strings — render one line per model. */
function costLines(note: string | null): string[] {
  if (!note) return [];
  return note
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function cell(value: string | null): ReactNode {
  return value ? value : <span style={{ color: 'var(--ink-4)' }}>—</span>;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Per-day intelligence/price series for the scatter time-lapse (30d, carry-forward client-side). */
function scatterHistory(models: { name: string }[]): import('@/components/ModelScatter').ScatterHistory | undefined {
  const DAYS = 30;
  const dateSet = new Set<string>();
  const intel: Record<string, (number | null)[]> = {};
  const price: Record<string, (number | null)[]> = {};
  const raw = new Map<string, { i: Map<string, number>; p: Map<string, number> }>();
  for (const m of models) {
    const iSeries = seriesFor('aa', m.name, 'intelligence', DAYS);
    const pSeries = seriesFor('aa', m.name, 'price_blended', DAYS);
    if (iSeries.length === 0 && pSeries.length === 0) continue;
    const entry = { i: new Map(iSeries.map((r) => [r.date, r.value])), p: new Map(pSeries.map((r) => [r.date, r.value])) };
    raw.set(m.name, entry);
    for (const d of [...entry.i.keys(), ...entry.p.keys()]) dateSet.add(d);
  }
  const dates = [...dateSet].sort();
  if (dates.length < 5) return undefined;
  for (const [name, entry] of raw) {
    intel[name] = dates.map((d) => entry.i.get(d) ?? null);
    price[name] = dates.map((d) => entry.p.get(d) ?? null);
  }
  return { dates, intel, price };
}

function domainLabel(domain: string): string {
  return isDomain(domain) ? DOMAIN_LABELS[domain] : domain;
}

export default async function BoardPage() {
  const user = await requireViewer();
  const db = getDb();
  // AA-derived data is gated for anonymous visitors: republication requires
  // a redistribution agreement with Artificial Analysis (see config.aaPublic).
  const showAA = !!user || config.aaPublic;
  const aa = showAA ? aaModels() : null;
  const media = showAA ? aaMedia() : null;
  const chartBrand = `${getIdentity().productName} · ${new URL(config.siteUrl).host}`;

  const entries = db
    .select()
    .from(boardEntries)
    .orderBy(boardEntries.domain, boardEntries.task)
    .all();

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const history = db
    .select()
    .from(boardHistory)
    .where(gte(boardHistory.appliedAt, cutoff))
    .orderBy(desc(boardHistory.appliedAt))
    .all();

  const byDomain = new Map<string, BoardEntry[]>();
  for (const entry of entries) {
    const list = byDomain.get(entry.domain) ?? [];
    list.push(entry);
    byDomain.set(entry.domain, list);
  }

  // the verdict column only earns its width when someone can edit or read one
  const showVerdict = !!user || entries.some((e) => e.runelabsVerdict);
  // history minus "no field changes" noise, capped — full log lives on /changelog
  const meaningfulHistory = history.filter((h) => !isNoopChange(h.change)).slice(0, 8);

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <PageHeader
        kicker="cost-benefit board &middot; weekly sync, human-approved"
        title="Best Right Now"
        description="The best AI tool for each task, ranked on quality vs. cost — updated weekly from benchmark data, every change human-approved."
      />

      <div className="mt-3">
        <BoardNav />
      </div>

      {/* the rankings first — the tables are the point of the page */}
      {entries.length === 0 && (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No board entries yet — the weekly board job drafts proposals; approved ones land here.
        </p>
      )}

      <div id="boards" className="scroll-mt-24" />
      {DOMAINS.map((domain) => {
        const rows = byDomain.get(domain);
        if (!rows || rows.length === 0) return null;
        return (
          <section key={domain}>
            <div className="mt-9 mb-2 flex items-center gap-3">
              <span className="readout inline-flex items-center gap-2" style={{ color: 'var(--ink-3)' }}>
                <span aria-hidden className="inline-block h-[10px] w-[2px]" style={{ background: DOMAIN_COLORS[domain] }} />
                {DOMAIN_LABELS[domain]}
              </span>
              <span aria-hidden className="h-px flex-1" style={{ background: 'var(--grat-soft)' }} />
            </div>
            <table className="table table-cards">
              <thead>
                <tr>
                  <th className="w-[17%]">Task</th>
                  <th className="w-[16%]">Best overall</th>
                  <th className="w-[15%]">Best value</th>
                  <th className="w-[15%]">Cheapest viable</th>
                  <th className="w-[21%]">Cost note</th>
                  {showVerdict && <th>Runelabs verdict</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="task" className="mono text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                      {entry.task}
                    </td>
                    {/* winner marking: phosphor tick on best overall (recommended pattern) */}
                    <td data-label="best overall" style={{ color: 'var(--ink)' }}>
                      <span className="inline-flex items-start gap-1.5">
                        {entry.bestOverall && (
                          <span aria-hidden className="mt-[5px] inline-block h-[9px] w-[2px] shrink-0" style={{ background: 'var(--phosphor)' }} />
                        )}
                        <span>{cell(entry.bestOverall)}</span>
                      </span>
                    </td>
                    <td data-label="best value">{cell(entry.bestValue)}</td>
                    <td data-label="cheapest">{cell(entry.cheapestViable)}</td>
                    <td data-label="cost note" className="text-[12.5px]">
                      {costLines(entry.costNote).length > 0 ? (
                        <span className="flex flex-col gap-0.5">
                          {costLines(entry.costNote).map((l, i) => (
                            <span key={i} className="mono text-[11px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                              {l}
                            </span>
                          ))}
                        </span>
                      ) : (
                        cell(null)
                      )}
                    </td>
                    {showVerdict && (
                      <td data-label="verdict">
                        <VerdictEditor
                          entryId={entry.id}
                          verdict={entry.runelabsVerdict}
                          author={entry.verdictAuthor}
                          canEdit={!!user}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {/* the evidence: market analytics below the rankings they support */}
      {aa && aa.models.length > 0 && (
        <>
          <div className="mt-10">
            <SectionHeader label="The data behind the rankings" />
          </div>
          <section id="market" className="scroll-mt-24">
            <SectionHeader label="The market — quality vs price" />
            <ChartFrame title="quality vs price" brand={chartBrand}>
              <ModelScatter models={aa.models} fetchedAt={aa.fetchedAt} history={scatterHistory(aa.models)} />
            </ChartFrame>
          </section>

          <section id="race" className="scroll-mt-24">
            <SectionHeader label="The race — intelligence over time" />
            <ChartFrame title="intelligence over time" brand={chartBrand}>
              <FrontierTimeline models={aa.models} />
            </ChartFrame>
          </section>

          <section id="forecast" className="scroll-mt-24">
            <SectionHeader label="Forecast — price of frontier intelligence" tone="phosphor" />
            <ChartFrame
              title="frontier price forecast"
              brand={chartBrand}
              caption={`forecast = frontier blended price, 30d horizon · linear trend over realized prices · as-of ${aa.fetchedAt}`}
            >
              <ForecastChart forecast={forecastFrontierPrice()} />
            </ChartFrame>
            <div className="mt-6">
              <div className="readout mb-2">timing lab — release&rarr;launch windows</div>
              <LagPanel readiness={lagReadiness()} findings={lagFindings()} />
            </div>
          </section>

          <section id="costs" className="scroll-mt-24">
            <SectionHeader label="Bottom line — cost per task" tone="phosphor" />
            <TaskCostExplorer models={aa.models} />
            <div className="mt-7">
              <CostMatrix models={aa.models} />
            </div>
          </section>

          <section id="value" className="scroll-mt-24">
            <SectionHeader label="Value — intelligence per dollar" />
            <ChartFrame title="intelligence per dollar" brand={chartBrand}>
              <ValueBars models={aa.models} />
            </ChartFrame>
          </section>
        </>
      )}

      {media && (
        <section id="arenas" className="scroll-mt-24">
          <SectionHeader label="Media arenas — crowd-ranked quality" />
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
            {media.arenas.image && <EloBars title="text to image" models={media.arenas.image} />}
            {media.arenas.video && <EloBars title="text to video" models={media.arenas.video} />}
            {media.arenas.imageEdit && (
              <EloBars title="image editing" models={media.arenas.imageEdit} />
            )}
          </div>
          <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
            arena ELO from human preference votes &middot;{' '}
            <a href="https://artificialanalysis.ai" target="_blank" rel="noreferrer" className="hover:underline">
              data: Artificial Analysis
            </a>{' '}
            &middot; {media.fetchedAt}
          </p>
        </section>
      )}

      <div id="changes" className="scroll-mt-24" />
      <SectionHeader label="Changed recently" count={meaningfulHistory.length} />
      {meaningfulHistory.length === 0 ? (
        <p className="mono text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No board changes in the last 14 days.
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {meaningfulHistory.map((h) => (
              <li
                key={h.id}
                className="border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
              >
                <div className="flex items-baseline gap-3">
                  <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                    {fmtDate(h.appliedAt)}
                  </span>
                  <span className="mono shrink-0 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                    {domainLabel(h.domain)} / {h.task}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-col gap-0.5 pl-[4.7rem]">
                  {formatBoardChange(h.change).map((f, i) => (
                    <span key={i} className="min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
                      <span className="mono text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
                        {f.field}{' '}
                      </span>
                      {f.text}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
            <Link href="/changelog" className="hover:underline">
              the full log lives on the changelog &rarr;
            </Link>
          </p>
        </>
      )}

      <div className="mt-8 border-t border-[var(--grat-soft)] pt-3">
        <span className="readout" style={{ color: 'var(--ink-4)' }}>
          embed this board
        </span>
        <code
          className="mono mt-1.5 block overflow-x-auto text-[10.5px]"
          style={{ color: 'var(--ink-3)' }}
        >
          {`<iframe src="${config.siteUrl}/embed/board" width="420" height="480" style="border:0" loading="lazy"></iframe>`}
        </code>
      </div>
    </div>
  );
}

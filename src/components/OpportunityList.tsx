'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';
import { fmtUsd } from '@/lib/costs';
import { SUB_KEYS, type SubScores } from '@/lib/opportunities/axes';
import type { OppKpis } from '@/lib/opportunities/engine';
import type { OppBrief } from '@/lib/opportunities/brief';
import SpiderChart, { gradeColor } from './SpiderChart';

const CHECK_LABELS: Record<keyof SubScores, string> = {
  demand: 'demand',
  buildability: 'buildable',
  margin: 'margin',
  competition: 'open field',
  timing: 'timing',
  moat: 'moat',
  regClear: 'regulation',
  platformSafe: 'platform',
  distribution: 'reach',
  qualityBar: 'quality',
};
const CHECK_PASS = 12; // an axis at 12+/20 clears its launch check

/** Simply-Wall-St checks pattern: N/10 clear, each glyph hoverable. */
function LaunchChecks({ sub }: { sub: SubScores }) {
  const results = SUB_KEYS.map((k) => ({ k, v: sub[k] ?? 0, pass: (sub[k] ?? 0) >= CHECK_PASS }));
  const passed = results.filter((r) => r.pass).length;
  return (
    <div
      className="mt-2 flex items-center gap-2"
      role="img"
      aria-label={`${passed} of ${SUB_KEYS.length} launch checks clear`}
    >
      <span className="readout text-[9px]">checks</span>
      <span className="mono text-[11px]" style={{ color: gradeColor((passed / SUB_KEYS.length) * 100) }}>
        {passed}/{SUB_KEYS.length}
      </span>
      <span className="mono flex gap-[3px] text-[10px]" aria-hidden>
        {results.map(({ k, v, pass }) => (
          <span
            key={k}
            title={`${CHECK_LABELS[k]}: ${v}/20 ${pass ? '✓' : '✗'}`}
            style={{ color: pass ? 'var(--phosphor)' : 'var(--ink-4)', cursor: 'default' }}
          >
            {pass ? '✓' : '✗'}
          </span>
        ))}
      </span>
    </div>
  );
}

export interface OppView {
  id: number;
  title: string;
  thesis: string;
  sector: string | null;
  window: string | null;
  flipScore: number;
  holdScore: number;
  sub: SubScores;
  kpis: OppKpis | null;
  /** row predates the 10-axis assessment — full dossier arrives on the next sweep */
  legacy: boolean;
  evidence: { type: string; label: string }[];
  brief: OppBrief | null;
  firstSeenLabel: string;
  isNew: boolean;
}

const EVIDENCE_GLYPH: Record<string, string> = {
  pain: '●',
  pattern: '▲',
  entity: '↗',
  story: '▪',
  market: '$',
  launches: '⚑',
};

function ScoreBar({ label, value, emphasized }: { label: string; value: number; emphasized: boolean }) {
  return (
    <span className="flex items-center gap-2" title={`${label} score ${value}/100`}>
      <span className="mono w-8 text-[10px] tracking-[0.1em] uppercase" style={{ color: emphasized ? 'var(--phosphor)' : 'var(--ink-4)' }}>
        {label}
      </span>
      <span className="h-[4px] min-w-16 flex-1 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
        <span
          className="anim-bar block h-full rounded-[1px]"
          style={{ width: `${value}%`, background: emphasized ? gradeColor(value) : 'var(--grat-strong)', opacity: 0.85 }}
        />
      </span>
      <span className="mono w-7 text-[12px]" style={{ color: emphasized ? 'var(--ink)' : 'var(--ink-3)' }}>
        {value}
      </span>
    </span>
  );
}

function KpiTile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-[86px]">
      <div className="readout text-[9px]">{label}</div>
      <div className="mono mt-0.5 text-[13px]" style={{ color: value ? 'var(--ink)' : 'var(--ink-4)' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

/** Inverted risk meter: high sub-score = low risk. */
function RiskMeter({ label, sub, note }: { label: string; sub: number; note?: string | null }) {
  const risk = 20 - sub;
  const color = risk <= 6 ? 'var(--phosphor)' : risk <= 12 ? 'var(--amber)' : 'var(--alert)';
  return (
    <div className="flex items-center gap-2" title={note ?? `${label}: risk ${risk}/20`}>
      <span className="readout w-[86px] shrink-0 text-[9px]">{label}</span>
      <span className="h-[4px] w-20 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
        <span className="anim-bar block h-full rounded-[1px]" style={{ width: `${(risk / 20) * 100}%`, background: color, opacity: 0.8 }} />
      </span>
      <span className="mono text-[10px]" style={{ color }}>
        {risk <= 6 ? 'low' : risk <= 12 ? 'med' : 'high'}
      </span>
    </div>
  );
}

function Competition({ kpis, sub }: { kpis: OppKpis | null; sub: SubScores }) {
  const count = kpis?.competitorCount ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="readout text-[9px]">competition</span>
      {count !== null ? (
        <>
          <span className="mono text-[11px]" aria-label={`${count} direct competitors`}>
            {Array.from({ length: Math.min(Math.round(count), 8) }, () => '▮').join('')}
            <span style={{ color: 'var(--ink-4)' }}>
              {Array.from({ length: Math.max(0, 8 - Math.round(count)) }, () => '░').join('')}
            </span>
            <span className="ml-1.5" style={{ color: 'var(--ink-3)' }}>
              {Math.round(count)}
              {count > 8 ? '+' : ''} direct
            </span>
          </span>
        </>
      ) : (
        <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
          field openness {sub.competition}/20
        </span>
      )}
      {kpis?.competitionNote && (
        <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--ink-3)' }}>
          {kpis.competitionNote}
        </span>
      )}
    </div>
  );
}

function BriefView({ brief }: { brief: OppBrief }) {
  const ue = brief.unitEconomics;
  return (
    <div className="anim-in mt-4 border-t border-[var(--grat-soft)] pt-4">
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <div className="readout mb-1.5">who pays</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>{brief.icp}</p>
        </div>
        <div>
          <div className="readout mb-1.5">mvp scope — 1-2 weeks</div>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {brief.mvp.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: 'var(--phosphor)' }}>▸</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="readout mb-1.5">stack</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {brief.stackVenture ? (
              <>
                <Link href="/stacks" className="underline decoration-[var(--grat-strong)] underline-offset-2" style={{ color: 'var(--ink)' }}>
                  {brief.stackVenture}
                </Link>{' '}
                playbook{brief.stackNotes ? ` — ${brief.stackNotes}` : ''}
              </>
            ) : (
              brief.stackNotes ?? '—'
            )}
          </p>
        </div>
        <div>
          <div className="readout mb-1.5">unit economics</div>
          <div className="mono flex flex-wrap gap-x-5 gap-y-1 text-[11px]" style={{ color: 'var(--ink-2)' }}>
            {ue.monthlyCostUsd !== null && (
              <span>
                <span style={{ color: 'var(--ink-4)' }}>run</span> ${ue.monthlyCostUsd}/mo
              </span>
            )}
            {ue.suggestedPriceUsd !== null && (
              <span>
                <span style={{ color: 'var(--ink-4)' }}>price</span> ${ue.suggestedPriceUsd}/mo
              </span>
            )}
            {ue.breakEvenCustomers !== null && (
              <span>
                <span style={{ color: 'var(--ink-4)' }}>break-even</span> {ue.breakEvenCustomers} customers
              </span>
            )}
          </div>
          {ue.assumptions.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
              {ue.assumptions.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="readout mb-1.5">go to market</div>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {brief.gtm.map((g, i) => (
              <li key={i}>· {g}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="readout mb-1.5">risks</div>
          <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {brief.risks.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: 'var(--amber)' }}>◆</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function fmtDays(v: number | null): string | null {
  return v === null ? null : `~${Math.round(v)}d`;
}

function Card({ opp, canGenerate, sortKey }: { opp: OppView; canGenerate: boolean; sortKey: 'flip' | 'hold' }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<OppBrief | null>(opp.brief);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = opp.kpis;

  async function expand() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!canGenerate && !brief) return;
    if (brief || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/brief`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { brief?: OppBrief; error?: string } | null;
      if (res.ok && data?.brief) setBrief(data.brief);
      else setError(data?.error ?? `request failed (${res.status})`);
    } catch {
      setError('request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <article id={`opp-${opp.id}`} className="card hover-raise scroll-mt-20 !p-5">
      <div className="gap-6 md:grid md:grid-cols-[218px_minmax(0,1fr)]">
        {/* the shape of the launch, at a glance */}
        <div className="mx-auto max-w-[240px] md:mx-0">
          {opp.legacy ? (
            <p className="mono py-8 text-center text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
              full 10-axis dossier
              <br />
              arrives on the next sweep
            </p>
          ) : (
            <SpiderChart sub={opp.sub} grade={sortKey === 'flip' ? opp.flipScore : opp.holdScore} />
          )}
          <div className="mt-1 flex flex-col gap-1.5">
            <ScoreBar label="flip" value={opp.flipScore} emphasized={sortKey === 'flip'} />
            <ScoreBar label="hold" value={opp.holdScore} emphasized={sortKey === 'hold'} />
          </div>
          {!opp.legacy && <LaunchChecks sub={opp.sub} />}
        </div>

        <div className="mt-4 min-w-0 md:mt-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {opp.isNew && (
              <span className="readout" style={{ color: 'var(--phosphor)' }}>
                ● new
              </span>
            )}
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{opp.title}</h2>
            {opp.sector && isDomain(opp.sector) && (
              <span className="mono inline-flex items-center gap-[5px] text-[10px] tracking-[0.06em]" style={{ color: 'var(--ink-3)' }}>
                <span aria-hidden className="inline-block h-[9px] w-[2px]" style={{ background: DOMAIN_COLORS[opp.sector] }} />
                {DOMAIN_LABELS[opp.sector].toUpperCase()}
              </span>
            )}
          </div>

          <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {opp.thesis}
          </p>

          {/* hard numbers */}
          <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-2.5 border-t border-[var(--grat-soft)] pt-3">
            <KpiTile label="initial cost" value={k?.initialCostUsd !== null && k ? fmtUsd(k.initialCostUsd!) : null} />
            <KpiTile label="run / mo" value={k?.monthlyCostUsd !== null && k ? fmtUsd(k.monthlyCostUsd!) : null} />
            <KpiTile label="price / mo" value={k?.priceUsd !== null && k ? fmtUsd(k.priceUsd!) : null} />
            <KpiTile label="time to mvp" value={fmtDays(k?.timeToMvpDays ?? null)} />
            <KpiTile label="break-even" value={k?.breakEvenCustomers != null ? `${Math.round(k.breakEvenCustomers)} cust` : null} />
            <KpiTile label="window" value={opp.window} />
          </div>

          {/* risk panel */}
          {!opp.legacy && (
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5">
              <RiskMeter label="regulation" sub={opp.sub.regClear} note={k?.regulatoryNote} />
              <RiskMeter label="platform dep" sub={opp.sub.platformSafe} />
              <RiskMeter label="quality effort" sub={opp.sub.qualityBar} />
            </div>
          )}
          {k?.regulatoryNote && (
            <p className="mono mt-1.5 text-[10.5px]" style={{ color: 'var(--amber)' }}>
              ◆ {k.regulatoryNote}
            </p>
          )}

          <div className="mt-3 border-t border-[var(--grat-soft)] pt-2.5">
            <Competition kpis={k} sub={opp.sub} />
          </div>

          {opp.evidence.length > 0 && (
            <div className="mono mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
              {opp.evidence.slice(0, 4).map((e, i) => (
                <span key={i} title={e.type}>
                  <span aria-hidden style={{ color: 'var(--ink-4)' }}>
                    {EVIDENCE_GLYPH[e.type] ?? '·'}{' '}
                  </span>
                  {e.label}
                </span>
              ))}
              {opp.evidence.length > 4 && <span style={{ color: 'var(--ink-4)' }}>+{opp.evidence.length - 4}</span>}
            </div>
          )}

          <div className="mt-3.5 flex items-center gap-4">
            <button type="button" onClick={expand} className={open ? 'btn' : 'btn btn-primary'}>
              {open ? 'collapse' : brief ? 'launch brief' : canGenerate ? 'draft launch brief' : 'launch brief (sign in)'}
            </button>
            <span className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
              first seen {opp.firstSeenLabel}
            </span>
          </div>
        </div>
      </div>

      {open &&
        (brief ? (
          <BriefView brief={brief} />
        ) : loading ? (
          <p className="mono mt-4 text-[11px]" style={{ color: 'var(--phosphor)' }}>
            drafting brief from live market data&hellip;
          </p>
        ) : error ? (
          <p className="mono mt-4 text-[11px]" style={{ color: 'var(--alert)' }}>
            {error}
          </p>
        ) : !canGenerate ? (
          <p className="mono mt-4 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            sign in to generate the launch brief
          </p>
        ) : null)}
    </article>
  );
}

/** Portfolio overview: every opening as a bubble — cost vs score, one glance across the field. */
function PortfolioScatter({ opps, sortKey }: { opps: OppView[]; sortKey: 'flip' | 'hold' }) {
  const W = 640;
  const H = 210;
  const PAD = { top: 10, right: 14, bottom: 24, left: 34 };
  const pts = useMemo(
    () =>
      opps
        .map((o) => ({ o, cost: o.kpis?.initialCostUsd ?? null }))
        .filter((p): p is { o: OppView; cost: number } => p.cost !== null && p.cost > 0),
    [opps],
  );
  if (pts.length < 3) return null;

  const minC = Math.min(...pts.map((p) => p.cost));
  const maxC = Math.max(...pts.map((p) => p.cost));
  const span = Math.max(0.001, Math.log10(maxC) - Math.log10(minC));
  const x = (c: number) => PAD.left + ((Math.log10(c) - Math.log10(minC)) / span) * (W - PAD.left - PAD.right);
  const y = (s: number) => PAD.top + (1 - s / 100) * (H - PAD.top - PAD.bottom);
  const score = (o: OppView) => (sortKey === 'flip' ? o.flipScore : o.holdScore);

  return (
    <div className="mb-5">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Openings: initial cost vs ${sortKey} score`}>
        {[0, 50, 100].map((s) => (
          <g key={s}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(s)} y2={y(s)} stroke="var(--grat-soft)" />
            <text x={PAD.left - 5} y={y(s) + 3} textAnchor="end" fontSize={9} fill="var(--ink-4)" fontFamily="var(--font-readout)">
              {s}
            </text>
          </g>
        ))}
        {pts.map(({ o, cost }) => (
          <a key={o.id} href={`#opp-${o.id}`}>
            <circle
              cx={x(cost)}
              cy={y(score(o))}
              r={7}
              fill={o.sector && isDomain(o.sector) ? DOMAIN_COLORS[o.sector] : 'var(--phosphor)'}
              fillOpacity={0.55}
              stroke="var(--scope-0)"
              strokeWidth={1.5}
            >
              <title>{`${o.title} — ${fmtUsd(cost)} initial · ${sortKey} ${score(o)}`}</title>
            </circle>
          </a>
        ))}
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={9} fill="var(--ink-4)" fontFamily="var(--font-readout)">
          initial cost (log) →
        </text>
      </svg>
      <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        top-left = cheap + strong &middot; each bubble is an opening (sector-tinted) &middot; click to jump to its dossier
      </p>
    </div>
  );
}

/** The scored feed: portfolio scatter + dossier cards, sortable by play. */
export default function OpportunityList({ opps, canGenerate }: { opps: OppView[]; canGenerate: boolean }) {
  const [sortKey, setSortKey] = useState<'flip' | 'hold'>('flip');
  const sorted = [...opps].sort((a, b) =>
    sortKey === 'flip' ? b.flipScore - a.flipScore : b.holdScore - a.holdScore,
  );
  return (
    <div>
      <div className="mono mb-3 flex items-center gap-1.5 text-[10px] tracking-[0.06em]">
        <span style={{ color: 'var(--ink-4)' }}>play</span>
        {(['flip', 'hold'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSortKey(k)}
            aria-pressed={sortKey === k}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              sortKey === k
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {k === 'flip' ? 'flip — build & sell' : 'hold — keep for mrr'}
          </button>
        ))}
      </div>
      <PortfolioScatter opps={opps} sortKey={sortKey} />
      <div className="flex flex-col gap-4">
        {sorted.map((o) => (
          <Card key={o.id} opp={o} canGenerate={canGenerate} sortKey={sortKey} />
        ))}
      </div>
    </div>
  );
}

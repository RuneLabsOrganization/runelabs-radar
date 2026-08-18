'use client';

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, isDomain, type Domain } from '@/lib/domains';
import { fmtUsd } from '@/lib/costs';
import { gradeBand, gradeColor } from '@/lib/opportunities/axes';
import OppDossier, { LaunchChecks, ScoreBar, VerdictChip, type OppView } from './OppDossier';
import BriefSection from './BriefSection';
import OpportunityMap from './OpportunityMap';
import PortfolioScatter from './PortfolioScatter';
import AssessmentMatrix from './AssessmentMatrix';

export type { OppView } from './OppDossier';

const ANALYSIS_KEY = 'radar.oppanalysis';

function Card({
  opp,
  canGenerate,
  sortKey,
  selected,
}: {
  opp: OppView;
  canGenerate: boolean;
  sortKey: 'flip' | 'hold';
  selected: boolean;
}) {
  // collapsed by default — the full dossier is an expand-away (Turo accordion
  // pattern); 39 expanded dossiers made a 22k px wall
  const [dossier, setDossier] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const k = opp.kpis;
  const primary = sortKey === 'flip' ? opp.flipScore : opp.holdScore;

  // a chart picked this opening: light it up and open its dossier
  useEffect(() => {
    if (!selected) return;
    setDossier(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [selected]);

  return (
    <article
      id={`opp-${opp.id}`}
      ref={ref}
      className="card hover-raise scroll-mt-20 !p-0"
      style={{
        ...(selected ? { outline: '1px solid var(--phosphor)' } : {}),
        ...(opp.verdict === 'reject' ? { opacity: 0.6 } : {}),
      }}
    >
      {/* the digest row: everything you need to triage, one glance */}
      <button
        type="button"
        onClick={() => setDossier((d) => !d)}
        aria-expanded={dossier}
        className="block w-full cursor-pointer p-5 text-left"
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {opp.isNew && (
                <span className="readout" style={{ color: 'var(--phosphor)' }}>
                  ● new
                </span>
              )}
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                <Link
                  href={`/opportunities/${opp.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                >
                  {opp.title}
                </Link>
              </h2>
              {opp.sector && isDomain(opp.sector) && (
                <span className="mono inline-flex items-center gap-[5px] text-[10px] tracking-[0.06em]" style={{ color: 'var(--ink-3)' }}>
                  <span aria-hidden className="inline-block h-[9px] w-[2px]" style={{ background: DOMAIN_COLORS[opp.sector] }} />
                  {DOMAIN_LABELS[opp.sector].toUpperCase()}
                </span>
              )}
              <VerdictChip verdict={opp.verdict} />
            </div>
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
              {opp.thesis}
            </p>
            <div className="mono mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
              {k?.initialCostUsd != null && <span>cost {fmtUsd(k.initialCostUsd)}</span>}
              {k?.priceUsd != null && <span>price {fmtUsd(k.priceUsd)}/mo</span>}
              {k?.timeToMvpDays != null && <span>mvp ~{Math.round(k.timeToMvpDays)}d</span>}
              {opp.window && <span>window {opp.window}</span>}
              <span>first seen {opp.firstSeenLabel}</span>
            </div>
            {!opp.legacy && (
              <div className="flex flex-wrap items-center gap-x-3">
                <LaunchChecks sub={opp.sub} />
                <span
                  className="mono mt-2 text-[10px]"
                  style={{ color: 'var(--ink-4)' }}
                  title="red-team confidence in this review"
                >
                  conf {opp.confidence}
                </span>
              </div>
            )}
          </div>
          <div className="flex w-[132px] shrink-0 flex-col gap-1.5">
            <ScoreBar label="flip" value={opp.flipScore} emphasized={sortKey === 'flip'} />
            <ScoreBar label="hold" value={opp.holdScore} emphasized={sortKey === 'hold'} />
            <span className="mono mt-0.5 flex items-baseline justify-between text-[11px]">
              <span style={{ color: gradeColor(primary) }} title={`${sortKey} score ${primary}/100`}>
                {gradeBand(primary)}
              </span>
              <span style={{ color: 'var(--ink-4)' }}>{dossier ? '▾ dossier' : '▸ dossier'}</span>
            </span>
          </div>
        </div>
      </button>

      {dossier && (
        <div className="anim-in border-t border-[var(--grat-soft)] p-5">
          <OppDossier opp={opp} sortKey={sortKey} />
          <div className="mt-3.5">
            <BriefSection id={opp.id} canGenerate={canGenerate} initialBrief={opp.brief} />
          </div>
        </div>
      )}
    </article>
  );
}

/** Shared chip style for the toolbar: phosphor border when on, graticule when off. */
function chipCls(on: boolean): string {
  return `cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
    on
      ? 'border-[var(--phosphor)] text-[var(--ink)]'
      : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
  }`;
}

/**
 * The scored feed: ranked dossier cards first — the field's charts (treemap +
 * lenses, cost scatter, assessment matrix) live behind the persisted "field
 * analysis" toggle and act as navigation: clicking any tile/dot/row selects,
 * scrolls to and expands the matching card.
 */
export default function OpportunityList({ opps, canGenerate }: { opps: OppView[]; canGenerate: boolean }) {
  const [sortKey, setSortKey] = useState<'flip' | 'hold'>('flip');
  const [sector, setSector] = useState<Domain | null>(null);
  const [analysis, setAnalysis] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  // restore the analyst's preferred view (client-only, like ThemeToggle)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(ANALYSIS_KEY) === '1') setAnalysis(true);
    } catch {
      // storage blocked — session default stands
    }
  }, []);

  const toggleAnalysis = () =>
    setAnalysis((a) => {
      try {
        window.localStorage.setItem(ANALYSIS_KEY, a ? '0' : '1');
      } catch {
        // storage blocked — toggle still works for this session
      }
      return !a;
    });

  const sectorCounts = useMemo(() => {
    const counts = new Map<Domain, number>();
    for (const o of opps) {
      if (o.sector && isDomain(o.sector)) counts.set(o.sector, (counts.get(o.sector) ?? 0) + 1);
    }
    return counts;
  }, [opps]);

  const filtered = useMemo(
    () => (sector ? opps.filter((o) => o.sector === sector) : opps),
    [opps, sector],
  );
  // the red team's rejects stay out of sight unless explicitly asked for
  const rejectedCount = useMemo(() => opps.filter((o) => o.verdict === 'reject').length, [opps]);
  const visible = useMemo(
    () => (showRejected ? filtered : filtered.filter((o) => o.verdict !== 'reject')),
    [filtered, showRejected],
  );
  const sorted = [...visible].sort((a, b) =>
    sortKey === 'flip' ? b.flipScore - a.flipScore : b.holdScore - a.holdScore,
  );

  return (
    <div>
      <div className="mono mb-3 flex flex-wrap items-center gap-1.5 text-[10px] tracking-[0.06em]">
        <button
          type="button"
          onClick={toggleAnalysis}
          aria-pressed={analysis}
          title="show the field charts — treemap, cost scatter, assessment matrix"
          className={chipCls(analysis)}
        >
          ▦ field analysis
        </button>
        <span className="mx-2 h-[10px] w-px" style={{ background: 'var(--grat)' }} aria-hidden />
        <span style={{ color: 'var(--ink-4)' }}>sort</span>
        {(['flip', 'hold'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSortKey(k)}
            aria-pressed={sortKey === k}
            title={k === 'flip' ? 'flip = speed + timing window' : 'hold = margin + durable demand'}
            className={chipCls(sortKey === k)}
          >
            {k === 'flip' ? 'flip — build & sell' : 'hold — keep for mrr'}
          </button>
        ))}
        <span className="mx-2 h-[10px] w-px" style={{ background: 'var(--grat)' }} aria-hidden />
        <span style={{ color: 'var(--ink-4)' }}>sector</span>
        <button
          type="button"
          onClick={() => setSector(null)}
          aria-pressed={sector === null}
          className={chipCls(sector === null)}
        >
          all {opps.length}
        </button>
        {DOMAINS.filter((d) => (sectorCounts.get(d) ?? 0) > 0).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setSector(sector === d ? null : d)}
            aria-pressed={sector === d}
            className={chipCls(sector === d)}
          >
            {DOMAIN_LABELS[d]} {sectorCounts.get(d)}
          </button>
        ))}
        {rejectedCount > 0 && (
          <>
            <span className="mx-2 h-[10px] w-px" style={{ background: 'var(--grat)' }} aria-hidden />
            <button
              type="button"
              onClick={() => setShowRejected((s) => !s)}
              aria-pressed={showRejected}
              title="openings the red team rejected — hidden by default"
              className={chipCls(showRejected)}
            >
              rejected {rejectedCount}
            </button>
          </>
        )}
      </div>

      {analysis && (
        <>
          <OpportunityMap opps={visible} sortKey={sortKey} onSelect={setSelectedId} />
          <PortfolioScatter opps={visible} sortKey={sortKey} onSelect={setSelectedId} />
          <AssessmentMatrix opps={sorted} sortKey={sortKey} onSelect={setSelectedId} />
        </>
      )}
      {sorted.length === 0 && rejectedCount > 0 && (
        <p className="mono mb-4 text-[11px]" style={{ color: 'var(--ink-4)' }}>
          every current opening is rejected by the red team — enable &ldquo;rejected&rdquo; above to inspect why
        </p>
      )}
      <div className="flex flex-col gap-4">
        {sorted.map((o) => (
          <Card key={o.id} opp={o} canGenerate={canGenerate} sortKey={sortKey} selected={o.id === selectedId} />
        ))}
      </div>
    </div>
  );
}

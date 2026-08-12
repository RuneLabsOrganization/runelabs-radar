'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, isDomain, type Domain } from '@/lib/domains';
import { fmtUsd } from '@/lib/costs';
import OppDossier, { ScoreBar, type OppView } from './OppDossier';
import BriefSection from './BriefSection';
import OpportunityMap from './OpportunityMap';
import AssessmentMatrix from './AssessmentMatrix';

export type { OppView } from './OppDossier';

function Card({ opp, canGenerate, sortKey }: { opp: OppView; canGenerate: boolean; sortKey: 'flip' | 'hold' }) {
  // collapsed by default — the full dossier is an expand-away (Turo accordion
  // pattern); 39 expanded dossiers made a 22k px wall
  const [dossier, setDossier] = useState(false);
  const k = opp.kpis;

  return (
    <article id={`opp-${opp.id}`} className="card hover-raise scroll-mt-20 !p-0">
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
          </div>
          <div className="flex w-[132px] shrink-0 flex-col gap-1.5">
            <ScoreBar label="flip" value={opp.flipScore} emphasized={sortKey === 'flip'} />
            <ScoreBar label="hold" value={opp.holdScore} emphasized={sortKey === 'hold'} />
            <span className="mono mt-0.5 text-right text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {dossier ? '▾ dossier' : '▸ dossier'}
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

/** The scored feed: money treemap + assessment matrix + dossier cards, sortable by play, filterable by sector. */
export default function OpportunityList({ opps, canGenerate }: { opps: OppView[]; canGenerate: boolean }) {
  const [sortKey, setSortKey] = useState<'flip' | 'hold'>('flip');
  const [sector, setSector] = useState<Domain | null>(null);

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
  const sorted = [...filtered].sort((a, b) =>
    sortKey === 'flip' ? b.flipScore - a.flipScore : b.holdScore - a.holdScore,
  );

  return (
    <div>
      <div className="mono mb-3 flex flex-wrap items-center gap-1.5 text-[10px] tracking-[0.06em]">
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
        <span className="mx-2 h-[10px] w-px" style={{ background: 'var(--grat)' }} aria-hidden />
        <span style={{ color: 'var(--ink-4)' }}>sector</span>
        <button
          type="button"
          onClick={() => setSector(null)}
          aria-pressed={sector === null}
          className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
            sector === null
              ? 'border-[var(--phosphor)] text-[var(--ink)]'
              : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
          }`}
        >
          all {opps.length}
        </button>
        {DOMAINS.filter((d) => (sectorCounts.get(d) ?? 0) > 0).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setSector(sector === d ? null : d)}
            aria-pressed={sector === d}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              sector === d
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {DOMAIN_LABELS[d]} {sectorCounts.get(d)}
          </button>
        ))}
      </div>
      <OpportunityMap opps={filtered} sortKey={sortKey} />
      <AssessmentMatrix opps={sorted} sortKey={sortKey} />
      <div className="flex flex-col gap-4">
        {sorted.map((o) => (
          <Card key={o.id} opp={o} canGenerate={canGenerate} sortKey={sortKey} />
        ))}
      </div>
    </div>
  );
}

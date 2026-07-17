'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';
import type { SubScores } from '@/lib/opportunities/engine';
import type { OppBrief } from '@/lib/opportunities/brief';

export interface OppView {
  id: number;
  title: string;
  thesis: string;
  sector: string | null;
  window: string | null;
  flipScore: number;
  holdScore: number;
  sub: SubScores;
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

const SUB_LABELS: [keyof SubScores, string][] = [
  ['demand', 'demand'],
  ['buildability', 'build'],
  ['margin', 'margin'],
  ['competition', 'comp'],
  ['timing', 'timing'],
];

function ScoreBar({ label, value, emphasized }: { label: string; value: number; emphasized: boolean }) {
  return (
    <span className="flex items-center gap-2" title={`${label} score ${value}/100`}>
      <span className="mono w-8 text-[10px] tracking-[0.1em] uppercase" style={{ color: emphasized ? 'var(--phosphor)' : 'var(--ink-4)' }}>
        {label}
      </span>
      <span className="h-[4px] w-24 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
        <span
          className="anim-bar block h-full rounded-[1px]"
          style={{ width: `${value}%`, background: emphasized ? 'var(--phosphor)' : 'var(--grat-strong)', opacity: 0.85 }}
        />
      </span>
      <span className="mono w-7 text-[11px]" style={{ color: emphasized ? 'var(--ink)' : 'var(--ink-3)' }}>
        {value}
      </span>
    </span>
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

function Card({ opp, canGenerate, sortKey }: { opp: OppView; canGenerate: boolean; sortKey: 'flip' | 'hold' }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<OppBrief | null>(opp.brief);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function expand() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // anonymous + no cached brief → show the sign-in hint, don't fire a doomed POST
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
    <article className="card hover-raise !p-5">
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
        {opp.window && (
          <span className="mono text-[10px] tracking-[0.06em] uppercase" style={{ color: 'var(--amber)' }}>
            window: {opp.window}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-8 gap-y-1.5">
        <ScoreBar label="flip" value={opp.flipScore} emphasized={sortKey === 'flip'} />
        <ScoreBar label="hold" value={opp.holdScore} emphasized={sortKey === 'hold'} />
      </div>

      <p className="mt-2.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
        {opp.thesis}
      </p>

      <div className="mono mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
        {SUB_LABELS.map(([k, label]) => (
          <span key={k}>
            {label} <span style={{ color: 'var(--ink-3)' }}>{opp.sub[k]}</span>
          </span>
        ))}
      </div>

      {opp.evidence.length > 0 && (
        <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
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
          {open
            ? 'collapse'
            : brief
              ? 'launch brief'
              : canGenerate
                ? 'draft launch brief'
                : 'launch brief (sign in)'}
        </button>
        <span className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
          first seen {opp.firstSeenLabel}
        </span>
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

/** The scored feed: sortable by the two plays, each card expandable into its brief. */
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
      <div className="flex flex-col gap-4">
        {sorted.map((o) => (
          <Card key={o.id} opp={o} canGenerate={canGenerate} sortKey={sortKey} />
        ))}
      </div>
    </div>
  );
}

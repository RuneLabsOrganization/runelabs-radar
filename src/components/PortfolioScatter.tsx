'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { isDomain, DOMAIN_COLORS } from '@/lib/domains';
import { fmtUsd } from '@/lib/costs';
import type { OppView } from './OppDossier';

/** Portfolio overview: every opening as a bubble — cost vs score, one glance across the field. */
export default function PortfolioScatter({
  opps,
  sortKey,
  onSelect,
}: {
  opps: OppView[];
  sortKey: 'flip' | 'hold';
  /** when set, bubble clicks select the matching list card instead of anchor-jumping */
  onSelect?: (id: number) => void;
}) {
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
            <text x={PAD.left - 5} y={y(s) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
              {s}
            </text>
          </g>
        ))}
        {pts.map(({ o, cost }) => (
          <a
            key={o.id}
            href={`#opp-${o.id}`}
            onClick={(e) => {
              if (!onSelect) return; // fall back to the plain anchor jump
              e.preventDefault();
              onSelect(o.id);
            }}
          >            <circle
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
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
          initial cost (log) →
        </text>
      </svg>
      <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        top-left = cheap + strong &middot; each bubble is an opening (sector-tinted) &middot; click to open its card below
      </p>
    </div>
  );
}

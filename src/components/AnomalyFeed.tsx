// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { PatternRow } from '@/lib/analytics';
import MiniTrend from './MiniTrend';

const KIND: Record<string, { glyph: string; color: string; label: string }> = {
  'sector-spike': { glyph: '▲', color: 'var(--phosphor)', label: 'sector spike' },
  'entity-surge': { glyph: '▲', color: 'var(--phosphor)', label: 'entity surge' },
  'entity-debut': { glyph: '▲', color: 'var(--phosphor)', label: 'new entity' },
  'launch-spike': { glyph: '▲', color: 'var(--phosphor)', label: 'launch wave' },
  'price-drop': { glyph: '▼', color: 'var(--phosphor)', label: 'price drop' },
  'cluster-heat': { glyph: '◆', color: 'var(--amber)', label: 'hot topic' },
  'pain-cluster': { glyph: '●', color: 'var(--amber)', label: 'recurring pain' },
};

/**
 * The chip shows the kind's NATIVE quantity — σ for z-detections, % for
 * price drops, × only for a real (shrunk) week-over-week ratio, a count as
 * a count — never one scale dressed as another. Exported for tests.
 */
export function scoreChip(p: PatternRow): string {
  if (p.kind === 'sector-spike' || p.kind === 'launch-spike') return `${p.score.toFixed(1)}σ`;
  if (p.kind === 'price-drop') return `−${Math.round(p.score * 10)}%`;
  if (p.kind === 'entity-surge') return `${p.score.toFixed(1)}×`;
  if (p.kind === 'entity-debut') return `+${Math.round(p.score)}`;
  if (p.kind === 'cluster-heat') return p.score.toFixed(2);
  return `${Math.round(p.score)}`; // pain-cluster: observation count
}

/**
 * The machine-noticed feed: today's strongest anomaly detections, each with
 * its underlying 14-day series on the right — the curve behind the claim.
 */
export default function AnomalyFeed({
  items,
  trends,
}: {
  items: PatternRow[];
  /** per-item daily series (mentions, stories, price…), index-aligned */
  trends?: (number[] | null)[];
}) {
  return (
    <ul className="flex flex-col">
      {items.map((p, i) => {
        const k = KIND[p.kind] ?? { glyph: '◆', color: 'var(--ink-3)', label: p.kind };
        return (
          <li
            key={i}
            className="flex items-start gap-3 border-b border-[var(--grat-soft)] py-3 first:pt-1 last:border-b-0"
          >
            <span
              className="mono w-4 shrink-0 pt-[1px] text-center text-[11px]"
              title={k.label}
              style={{ color: k.color }}
            >
              {k.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-[13.5px] leading-snug font-semibold">{p.headline}</span>
                <span className="mono text-[10px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
                  {k.label}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                {p.detail}
              </p>
            </div>
            <div className="hidden sm:block">
              <MiniTrend
                values={trends?.[i] ?? null}
                color={k.color}
                caption={p.kind === 'price-drop' ? '$ · 14d' : '14d'}
              />
            </div>
            <span className="mono shrink-0 pt-[2px] text-[10.5px]" style={{ color: k.color }}>
              {scoreChip(p)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { DOMAIN_COLORS, DOMAIN_LABELS, type Domain } from '@/lib/domains';
import MiniTrend from './MiniTrend';

export interface SectorStat {
  domain: Domain;
  count: number;
  fresh: number;
  /** Week-over-week volume change (%); null hides the momentum readout. */
  deltaPct?: number | null;
  /** 14-day daily story counts — rendered as an inline sparkline when present. */
  series?: number[] | null;
  /** the series' last bucket is today's partial UTC day — hatch it, don't accent it */
  partialLast?: boolean;
}

/** Sweep readout across the six sectors — doubles as domain navigation. */
export default function SectorStrip({ stats, active }: { stats: SectorStat[]; active?: Domain }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {stats.map(({ domain, count, fresh, deltaPct, series, partialLast }) => (
        <Link
          key={domain}
          href={`/domain/${domain}`}
          className={`hover-raise rounded-[5px] border bg-[var(--scope-1)] px-2.5 py-2 ${
            active === domain
              ? 'border-[var(--grat-strong)]'
              : 'border-[var(--grat-soft)] hover:border-[var(--grat)]'
          }`}
        >
          <span className="mono flex items-center gap-1.5 text-[10px] tracking-[0.08em]" style={{ color: 'var(--ink-3)' }}>
            <span aria-hidden className="inline-block h-[9px] w-[2px]" style={{ background: DOMAIN_COLORS[domain] }} />
            {DOMAIN_LABELS[domain].toUpperCase()}
          </span>
          <span
            className="mono mt-1 flex items-baseline gap-1.5 text-[15px]"
            style={{ color: count > 0 ? 'var(--ink)' : 'var(--ink-4)' }}
          >
            {count}
            {fresh > 0 && (
              <span className="text-[10.5px]" style={{ color: 'var(--phosphor)' }}>
                +{fresh}
              </span>
            )}
            {deltaPct != null && deltaPct !== 0 && (
              <span
                className="ml-auto text-[10px]"
                title="volume vs last week"
                style={{ color: deltaPct > 0 ? 'var(--phosphor)' : 'var(--ink-4)' }}
              >
                {deltaPct > 0 ? '+' : ''}
                {deltaPct}%
              </span>
            )}
          </span>
          {series && series.length > 0 && (
            <span className="mt-1.5 block" aria-hidden>
              <MiniTrend values={series} color={DOMAIN_COLORS[domain]} height={20} fluid partialLast={partialLast} />
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

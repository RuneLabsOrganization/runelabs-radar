// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { SourceVolumeRow } from '@/lib/analytics';

const SPARK_W = 100;
const SPARK_H = 16;

function Sparkline({ daily }: { daily: number[] }) {
  const max = Math.max(1, ...daily);
  const step = daily.length <= 1 ? 0 : SPARK_W / (daily.length - 1);
  const points = daily
    .map((v, i) => `${i * step},${SPARK_H - 2 - (v / max) * (SPARK_H - 4)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="h-[16px] w-[100px]" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--phosphor)" strokeWidth={1} opacity={0.65} />
    </svg>
  );
}

/** Which feeds carry the signal: 14-day sparkline + 7-day volume per source. */
export default function SourceVolume({ rows }: { rows: SourceVolumeRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="mono text-[11px]" style={{ color: 'var(--ink-4)' }}>
        No items ingested in the window yet.
      </p>
    );
  }
  const max7d = Math.max(1, rows[0].total7d);
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li
          key={r.name}
          className="flex items-center gap-3 border-b border-[var(--grat-soft)] py-[5px] last:border-b-0"
        >
          <span className="mono min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--ink-2)' }}>
            {r.name}
          </span>
          <Sparkline daily={r.daily} />
          <span className="mono w-24 shrink-0" title={`${r.total7d} items in 7 days`}>
            <span
              className="inline-block h-[3px] rounded-[1px] align-middle"
              style={{ width: `${Math.max(3, (r.total7d / max7d) * 60)}px`, background: 'var(--grat-strong)' }}
            />
            <span className="ml-1.5 align-middle text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
              {r.total7d}
            </span>
          </span>
          <span
            className="mono w-16 shrink-0 text-right text-[10.5px]"
            style={{ color: 'var(--ink-4)' }}
            title={`${r.used7d} of ${r.total7d} items made it into a story (7d)`}
          >
            {r.total7d > 0 ? `${Math.round((r.used7d / r.total7d) * 100)}% used` : '—'}
          </span>
        </li>
      ))}
    </ul>
  );
}

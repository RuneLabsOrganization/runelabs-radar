// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { AaModel } from '@/lib/pareto';

const INTELLIGENCE_FLOOR = 25;
const LIMIT = 12;

/**
 * Intelligence per dollar — the raw value ranking. Floor excludes weak models
 * whose near-zero price would otherwise dominate the ratio.
 */
export default function ValueBars({ models }: { models: AaModel[] }) {
  const rows = models
    .filter((m) => m.intelligence >= INTELLIGENCE_FLOOR && m.price > 0)
    .map((m) => ({ m, value: m.intelligence / m.price }))
    .sort((a, b) => b.value - a.value)
    .slice(0, LIMIT);
  if (rows.length === 0) return null;
  const max = rows[0].value;

  return (
    <div>
      <ul className="flex flex-col gap-[7px]">
        {rows.map(({ m, value }) => (
          <li key={m.name} title={`${m.name} — intelligence ${m.intelligence}, $${m.price}/1M blended`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="mono min-w-0 truncate text-[11px]" style={{ color: 'var(--ink-2)' }}>
                {m.name}
                {m.org && <span style={{ color: 'var(--ink-4)' }}> &middot; {m.org}</span>}
              </span>
              <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                <span style={{ color: 'var(--ink-4)' }}>
                  {m.intelligence} @ ${m.price}
                </span>
                <span className="ml-2" style={{ color: 'var(--ink)' }}>
                  {value.toFixed(value >= 10 ? 0 : 1)} pts/$
                </span>
              </span>
            </div>
            <div className="mt-[3px] h-[3px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
              <div
                className="anim-bar h-full rounded-[1px]"
                style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: 'var(--phosphor)', opacity: 0.75 }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        intelligence index points per blended $/1M &middot; models &ge;{INTELLIGENCE_FLOOR} intelligence only
      </p>
    </div>
  );
}

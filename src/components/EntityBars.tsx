// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { EntityCount } from '@/lib/analytics';

function delta(e: EntityCount): { text: string; color: string } {
  if (e.prev === 0) return { text: 'new', color: 'var(--phosphor)' };
  const d = e.count - e.prev;
  if (d > 0) return { text: `+${d}`, color: 'var(--phosphor)' };
  if (d < 0) return { text: `${d}`, color: 'var(--ink-4)' };
  return { text: '=', color: 'var(--ink-4)' };
}

/** Most-mentioned models/tools this week, with week-over-week movement. */
export default function EntityBars({ entities }: { entities: EntityCount[] }) {
  if (entities.length === 0) {
    return (
      <p className="mono text-[11px]" style={{ color: 'var(--ink-4)' }}>
        Entity tracking warms up as new stories are curated.
      </p>
    );
  }
  const max = entities[0].count;
  return (
    <ul className="flex flex-col gap-[7px]">
      {entities.map((e) => {
        const d = delta(e);
        return (
          <li key={`${e.kind}:${e.name.toLowerCase()}`} title={`${e.name} (${e.kind}) — ${e.count} mentions this week, ${e.prev} last week`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="mono min-w-0 truncate text-[11px]" style={{ color: 'var(--ink-2)' }}>
                {e.name}
              </span>
              <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                {e.count}
                <span className="ml-1.5" style={{ color: d.color }}>
                  {d.text}
                </span>
              </span>
            </div>
            <div className="mt-[3px] h-[3px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
              <div
                className="h-full rounded-[1px]"
                style={{ width: `${Math.max(4, (e.count / max) * 100)}%`, background: 'var(--phosphor)', opacity: 0.75 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

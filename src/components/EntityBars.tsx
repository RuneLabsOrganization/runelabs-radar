// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import type { EntityCount } from '@/lib/analytics';
import { entitySlug } from '@/lib/entity';

function delta(e: EntityCount): { text: string; color: string } {
  if (e.prev === 0) return { text: 'new', color: 'var(--phosphor)' };
  const d = e.count - e.prev;
  if (d > 0) return { text: `+${d}`, color: 'var(--phosphor)' };
  if (d < 0) return { text: `${d}`, color: 'var(--ink-4)' };
  return { text: '=', color: 'var(--ink-4)' };
}

/** Most-mentioned models/tools this week, with week-over-week movement. */
export default function EntityBars({
  entities,
  hype,
}: {
  entities: EntityCount[];
  /** name (lowercase) → hype-vs-substance score 0-100, from lib/science/hype */
  hype?: Map<string, number>;
}) {
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
        const h = hype?.get(e.name.toLowerCase());
        const hColor = h === undefined ? '' : h > 70 ? 'var(--amber)' : h < 30 ? 'var(--phosphor)' : 'var(--ink-4)';
        return (
          <li key={`${e.kind}:${e.name.toLowerCase()}`} title={`${e.name} (${e.kind}) — ${e.count} mentions this week, ${e.prev} last week${h !== undefined ? ` · hype/substance ${h}` : ''}`}>
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={`/entity/${entitySlug(e.name)}`}
                className="mono min-w-0 truncate text-[11px] hover:underline"
                style={{ color: 'var(--ink-2)' }}
              >
                {e.name}
              </Link>
              <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                {h !== undefined && (
                  <span className="mr-1.5" style={{ color: hColor }} title="hype vs substance — high = loud, low = shipping">
                    H/S {h}
                  </span>
                )}
                {e.count}
                <span className="ml-1.5" style={{ color: d.color }}>
                  {d.text}
                </span>
              </span>
            </div>
            <div className="mt-[3px] h-[3px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
              <div
                className="anim-bar h-full rounded-[1px]"
                style={{ width: `${Math.max(4, (e.count / max) * 100)}%`, background: 'var(--phosphor)', opacity: 0.75 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

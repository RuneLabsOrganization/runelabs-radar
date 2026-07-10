// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { DOMAIN_COLORS, DOMAIN_LABELS } from '@/lib/domains';
import type { Insight } from '@/lib/analytics';

const DIRECTION: Record<Insight['direction'], { glyph: string; color: string; label: string }> = {
  up: { glyph: '▲', color: 'var(--phosphor)', label: 'rising' },
  down: { glyph: '▼', color: 'var(--alert)', label: 'fading' },
  watch: { glyph: '◆', color: 'var(--amber)', label: 'watch' },
};

/** The day's LLM-written analyst calls: trend claims with a direction, not summaries. */
export default function AnalystNotes({ items }: { items: Insight[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((n, i) => {
        const dir = DIRECTION[n.direction];
        return (
          <li
            key={i}
            className="flex items-start gap-3 border-b border-[var(--grat-soft)] py-3 first:pt-1 last:border-b-0"
          >
            <span
              aria-label={dir.label}
              title={dir.label}
              className="mono w-4 shrink-0 pt-[1px] text-center text-[11px]"
              style={{ color: dir.color }}
            >
              {dir.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-[13.5px] font-semibold leading-snug">{n.headline}</span>
                {n.domain && (
                  <span
                    className="mono inline-flex items-center gap-[5px] text-[10px] tracking-[0.06em]"
                    style={{ color: 'var(--ink-4)' }}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-[8px] w-[2px]"
                      style={{ background: DOMAIN_COLORS[n.domain] }}
                    />
                    {DOMAIN_LABELS[n.domain].toUpperCase()}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                {n.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

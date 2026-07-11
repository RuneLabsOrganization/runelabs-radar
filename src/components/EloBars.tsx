// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { MediaModel } from '@/lib/analytics';

/** Arena ELO ranking for one media modality (image / video / image editing). */
export default function EloBars({ title, models }: { title: string; models: MediaModel[] }) {
  if (models.length === 0) return null;
  const max = models[0].elo;
  const min = models[models.length - 1].elo;
  const span = Math.max(1, max - min);

  return (
    <div>
      <div className="readout mb-2.5">{title}</div>
      <ul className="flex flex-col gap-[7px]">
        {models.map((m) => (
          <li key={`${m.rank}-${m.name}`} title={`${m.name}${m.org ? ` (${m.org})` : ''} — arena ELO ${m.elo}${m.released ? `, released ${m.released}` : ''}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="mono min-w-0 truncate text-[11px]" style={{ color: 'var(--ink-2)' }}>
                <span style={{ color: 'var(--ink-4)' }}>#{m.rank}</span> {m.name}
              </span>
              <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                {m.elo}
              </span>
            </div>
            <div className="mt-[3px] h-[3px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
              <div
                className="anim-bar h-full rounded-[1px]"
                style={{
                  width: `${25 + ((m.elo - min) / span) * 75}%`,
                  background: m.rank === 1 ? 'var(--phosphor)' : 'var(--grat-strong)',
                  opacity: m.rank === 1 ? 0.8 : 0.9,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { clamp } from '@/lib/stats';
import type { MediaModel } from '@/lib/analytics';

/**
 * Disclosed fixed domain for the bars. Arena ELO is an absolute rating — a
 * field spanning 1100–1105 is a photo finish, and min-max normalization used
 * to render it with the same dramatic spread as 1100–1400 (plus a 25% floor
 * that hid even that). Bars below are fractions of THIS scale, so they are
 * comparable across modalities and across days.
 */
export const ELO_DOMAIN = { min: 1000, max: 1500 } as const;

export interface EloBar {
  model: MediaModel;
  /** 0–100 fraction of the fixed ELO_DOMAIN, clamped */
  widthPct: number;
}

/**
 * Sorted (ELO desc — never trusts caller order) bar layout against the fixed
 * domain. Pure — exported for tests.
 */
export function eloBarLayout(models: MediaModel[]): EloBar[] {
  return [...models]
    .sort((a, b) => b.elo - a.elo)
    .map((model) => ({
      model,
      widthPct: clamp(((model.elo - ELO_DOMAIN.min) / (ELO_DOMAIN.max - ELO_DOMAIN.min)) * 100, 0, 100),
    }));
}

/** Discloses the scale and the actual span, so a photo finish reads as one. */
export function eloScaleCaption(models: MediaModel[]): string {
  if (models.length === 0) return '';
  const elos = models.map((m) => m.elo);
  const span = Math.max(...elos) - Math.min(...elos);
  return `absolute scale · arena ELO ${ELO_DOMAIN.min}–${ELO_DOMAIN.max} · field span ${span}`;
}

/** Arena ELO ranking for one media modality (image / video / image editing). */
export default function EloBars({ title, models }: { title: string; models: MediaModel[] }) {
  if (models.length === 0) return null;
  const bars = eloBarLayout(models);

  return (
    <div>
      <div className="readout mb-2.5">{title}</div>
      <ul className="flex flex-col gap-[7px]">
        {bars.map(({ model: m, widthPct }) => (
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
                  width: `${widthPct}%`,
                  background: m.rank === 1 ? 'var(--phosphor)' : 'var(--grat-strong)',
                  opacity: m.rank === 1 ? 0.8 : 0.9,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        {eloScaleCaption(models)}
      </p>
    </div>
  );
}

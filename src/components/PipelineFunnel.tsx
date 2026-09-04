// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { TOP_SIGNAL_MIN } from '@/lib/feed';
import type { Funnel } from '@/lib/analytics';

export interface FunnelStage {
  label: string;
  value: number;
}

/**
 * The four pipeline stages as raw 7-day counts. Deliberately NOT conversion
 * percentages: the stages are different cohorts (this week's curated stories
 * did not come from this week's fetched items), so a stage-to-stage "%" would
 * be a cohort fallacy dressed as a funnel. Pure — exported for tests.
 */
export function funnelStages(funnel: Funnel): FunnelStage[] {
  return [
    { label: 'items fetched', value: funnel.items },
    { label: 'stories', value: funnel.stories },
    { label: 'curated', value: funnel.curated },
    { label: `top signals ≥${TOP_SIGNAL_MIN}`, value: funnel.topSignals },
  ];
}

export const FUNNEL_CAPTION = '7-day count per stage — not one cohort, so no conversion %';

/** 7-day pipeline volume per stage: raw items → stories → curated → top signals. */
export default function PipelineFunnel({ funnel }: { funnel: Funnel }) {
  const stages = funnelStages(funnel);
  const max = Math.max(1, stages[0].value);

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <li key={s.label}>
            <div className="mono flex items-baseline justify-between text-[10.5px]">
              <span style={{ color: 'var(--ink-3)' }}>{s.label}</span>
              <span style={{ color: 'var(--ink)' }}>{s.value.toLocaleString()}</span>
            </div>
            <div className="mt-[3px] h-[4px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
              <div
                className="h-full rounded-[1px]"
                style={{
                  width: `${Math.max(2.5, (s.value / max) * 100)}%`,
                  background: i === stages.length - 1 ? 'var(--phosphor)' : 'var(--grat-strong)',
                  opacity: 0.85,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        {FUNNEL_CAPTION}
      </p>
    </div>
  );
}

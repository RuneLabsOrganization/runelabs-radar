// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { Funnel } from '@/lib/analytics';

/** 7-day pipeline conversion: raw items → stories → curated → top signals. */
export default function PipelineFunnel({ funnel }: { funnel: Funnel }) {
  const stages = [
    { label: 'items fetched', value: funnel.items },
    { label: 'stories', value: funnel.stories },
    { label: 'curated', value: funnel.curated },
    { label: 'top signals', value: funnel.topSignals },
  ];
  const max = Math.max(1, stages[0].value);

  return (
    <ul className="flex flex-col gap-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label}>
            <div className="mono flex items-baseline justify-between text-[10.5px]">
              <span style={{ color: 'var(--ink-3)' }}>{s.label}</span>
              <span>
                <span style={{ color: 'var(--ink)' }}>{s.value.toLocaleString()}</span>
                {conv !== null && (
                  <span className="ml-1.5" style={{ color: 'var(--ink-4)' }}>
                    {conv}%
                  </span>
                )}
              </span>
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
        );
      })}
    </ul>
  );
}

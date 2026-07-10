// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';

/** Daily LLM spend against the call cap: today's gauge + 14-day trend. */
export default function LlmBudget({
  days,
  cap,
}: {
  days: { date: string; calls: number }[];
  cap: number;
}) {
  const today = days[days.length - 1];
  const pct = Math.min(100, (today.calls / Math.max(1, cap)) * 100);
  const gaugeColor = pct >= 90 ? 'var(--alert)' : pct >= 60 ? 'var(--amber)' : 'var(--phosphor)';

  return (
    <div>
      <div className="mono mb-1.5 flex items-baseline justify-between text-[11px]">
        <span style={{ color: 'var(--ink-2)' }}>
          today <span style={{ color: 'var(--ink)' }}>{today.calls}</span>
          <span style={{ color: 'var(--ink-4)' }}> / {cap} calls</span>
        </span>
        <span style={{ color: gaugeColor }}>{Math.round(pct)}%</span>
      </div>
      <div className="h-[5px] w-full rounded-[2px]" style={{ background: 'var(--grat-soft)' }}>
        <div
          className="h-full rounded-[2px]"
          style={{ width: `${Math.max(1, pct)}%`, background: gaugeColor, opacity: 0.8 }}
        />
      </div>
      <div className="mt-3 flex items-end gap-[3px]" aria-label="daily LLM calls, last 14 days">
        {days.map((d) => (
          <span
            key={d.date}
            title={`${d.date}: ${d.calls} calls`}
            className="w-full rounded-t-[1px]"
            style={{
              height: `${4 + (Math.min(d.calls, cap) / Math.max(1, cap)) * 26}px`,
              background: d.calls > 0 ? 'var(--grat-strong)' : 'var(--grat-soft)',
            }}
          />
        ))}
      </div>
      <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        14-day call volume &middot; cap {cap}/day
      </p>
    </div>
  );
}

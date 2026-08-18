// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { JobUsage } from '@/lib/analytics';

/** Daily LLM spend against the call cap: today's gauge + pace projection + 14-day trend + per-job burn. */
export default function LlmBudget({
  days,
  cap,
  byJob = [],
}: {
  days: { date: string; calls: number }[];
  cap: number;
  byJob?: JobUsage[];
}) {
  const today = days[days.length - 1];
  const pct = Math.min(100, (today.calls / Math.max(1, cap)) * 100);
  const gaugeColor = pct >= 90 ? 'var(--alert)' : pct >= 60 ? 'var(--amber)' : 'var(--phosphor)';

  // end-of-day projection from the UTC-day pace so far
  const now = new Date();
  const dayFrac = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86400;
  const projected = today.calls > 0 && dayFrac > 0.01 ? Math.round(today.calls / dayFrac) : null;

  const jobs = byJob.filter((j) => j.calls > 0);

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
        {projected !== null && <> &middot; pace &rarr; ~{projected} by 00:00 UTC</>}
      </p>

      {jobs.length > 0 && (
        <div className="mt-4">
          <div className="readout mb-1.5">by job &middot; today</div>
          <ul className="flex flex-col">
            {jobs.map((j) => (
              <li
                key={j.job}
                className="flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[4px] text-[11px] last:border-b-0"
              >
                <span className="mono min-w-0 flex-1 truncate" style={{ color: 'var(--ink-2)' }}>
                  {j.job}
                </span>
                <span className="mono shrink-0 tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  {j.calls} calls
                </span>
                <span className="mono w-20 shrink-0 text-right tabular-nums" style={{ color: 'var(--ink-4)' }}>
                  {j.tokens.toLocaleString('en-US')} tok
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

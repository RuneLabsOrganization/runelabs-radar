// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { JobRunCell } from '@/lib/analytics';
import { timeAgo } from '@/lib/feed';

const STATUS_COLOR: Record<JobRunCell['status'], string> = {
  ok: 'var(--phosphor)',
  error: 'var(--alert)',
  running: 'var(--amber)',
};

function fmtDuration(ms: number | null): string {
  if (ms === null) return '…';
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s}s` : `${Math.round(s / 60)}m`;
}

/** Run-by-run health strip per job — errors jump out as red blocks. */
export default function JobTimeline({ history }: { history: Record<string, JobRunCell[]> }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {Object.entries(history).map(([job, runs]) => {
        const last = runs[runs.length - 1] ?? null;
        return (
          <li key={job} className="flex items-center gap-3">
            <span className="readout w-14 shrink-0">{job}</span>
            <span className="flex min-w-0 flex-1 items-center gap-[3px]">
              {runs.length === 0 ? (
                <span className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
                  never ran
                </span>
              ) : (
                runs.map((r, i) => (
                  <span
                    key={i}
                    title={`${r.startedAt.toISOString().replace('T', ' ').slice(0, 16)} — ${r.status}, ${fmtDuration(r.durationMs)}`}
                    className="h-[14px] w-[7px] shrink-0 rounded-[1px]"
                    style={{ background: STATUS_COLOR[r.status], opacity: r.status === 'ok' ? 0.45 : 0.95 }}
                  />
                ))
              )}
            </span>
            {last && (
              <span className="mono w-32 shrink-0 text-right text-[10px]" style={{ color: 'var(--ink-4)' }}>
                {timeAgo(last.startedAt)} &middot; {fmtDuration(last.durationMs)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

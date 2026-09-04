import type { CSSProperties, ReactNode } from 'react';
import type { jobRuns } from '@/lib/db/schema';
import { fmtDurationMs } from '@/lib/format';

export type JobRun = typeof jobRuns.$inferSelect;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// UTC, same ISO style as JobTimeline — LLM usage buckets and the timeline
// tooltip are all UTC, so the jobs table must not render server-local time
function fmtStarted(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function fmtDuration(run: JobRun): string {
  if (!run.finishedAt) return '—';
  return fmtDurationMs(run.finishedAt.getTime() - run.startedAt.getTime());
}

function statusBadge(status: JobRun['status']): ReactNode {
  const styles: Record<JobRun['status'], CSSProperties | undefined> = {
    ok: { color: 'var(--up)', borderColor: 'var(--up)' },
    error: { color: 'var(--down)', borderColor: 'var(--down)' },
    running: undefined, // default .badge is muted
  };
  return (
    <span className="badge" style={styles[status]}>
      {status}
    </span>
  );
}

export default function JobsPanel({ runs }: { runs: JobRun[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Error</th>
            <th>Stats</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No job runs yet.
              </td>
            </tr>
          )}
          {runs.map((run) => (
            <tr key={run.id}>
              <td style={{ fontWeight: 600 }}>{run.job}</td>
              <td className="muted">{fmtStarted(run.startedAt)}</td>
              <td className="muted">{fmtDuration(run)}</td>
              <td>{statusBadge(run.status)}</td>
              <td>
                {run.error ? (
                  <span title={run.error} style={{ color: 'var(--down)' }}>
                    {truncate(run.error, 120)}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {run.stats ? (
                  <span className="muted" title={run.stats}>
                    {truncate(run.stats, 80)}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

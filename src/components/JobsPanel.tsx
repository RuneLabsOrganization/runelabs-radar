import type { CSSProperties, ReactNode } from 'react';
import type { jobRuns } from '@/lib/db/schema';

export type JobRun = typeof jobRuns.$inferSelect;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtStarted(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(run: JobRun): string {
  if (!run.finishedAt) return '—';
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
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
    <div className="card">
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

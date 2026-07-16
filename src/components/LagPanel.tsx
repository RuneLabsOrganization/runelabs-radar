// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { LagFinding, LagReadiness } from '@/lib/science/lag';

/** Release→launch timing correlations — honest warming-up meter until the history exists. */
export default function LagPanel({
  readiness,
  findings,
}: {
  readiness: LagReadiness;
  findings: LagFinding[];
}) {
  return (
    <div>
      {readiness.ready ? (
        findings.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {findings.map((f, i) => (
              <li key={i} className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                  {f.leader}
                </span>{' '}
                lead <span className="font-semibold">{f.follower}</span> by ~{f.lagDays}d
                <span className="mono ml-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  r = {f.coefficient.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mono text-[12px]" style={{ color: 'var(--ink-4)' }}>
            History is deep enough, but no timing correlation above the confidence bar yet.
          </p>
        )
      ) : (
        <div>
          <div className="mono mb-1.5 flex items-baseline justify-between text-[11px]">
            <span style={{ color: 'var(--ink-3)' }}>
              collecting launch/category history for lag correlations
            </span>
            <span style={{ color: 'var(--amber)' }}>
              {readiness.days}/{readiness.needed} days
            </span>
          </div>
          <div className="h-[4px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
            <div
              className="anim-bar h-full rounded-[1px]"
              style={{
                width: `${Math.max(2, (readiness.days / readiness.needed) * 100)}%`,
                background: 'var(--amber)',
                opacity: 0.7,
              }}
            />
          </div>
          <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
            unlocks release&rarr;launch window detection (e.g. &quot;media-model waves precede
            content-tool launches by ~N days&quot;)
          </p>
        </div>
      )}
    </div>
  );
}

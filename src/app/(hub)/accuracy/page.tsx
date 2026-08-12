import { requireViewer } from '@/lib/auth/user';
import { calibrationBuckets, forecastGrades } from '@/lib/science/accuracy';
import SectionHeader from '@/components/SectionHeader';

export const metadata = {
  title: 'Accuracy — our track record',
  description:
    'Do our scores hold up? Score calibration against hindsight (echoes, launches, follow-ups measured 2 days later) and forecast grades. Published, not claimed.',
};

/**
 * The moat made visible: we grade ourselves in public. Nobody else in the
 * AI-intelligence space publishes calibration — after enough weeks this page
 * is impossible to clone.
 */
export default async function AccuracyPage() {
  await requireViewer();
  const buckets = calibrationBuckets();
  const grades = forecastGrades();
  const graded = grades.filter((g) => g.realized !== null);
  const totalHindsight = buckets.reduce((n, b) => n + b.count, 0);

  return (
    <>
      <SectionHeader label="Accuracy — the track record, graded" tone="phosphor" />
      <p className="muted mt-3 max-w-[62ch] text-[13px] leading-relaxed">
        Every story gets a relevance score when it lands on the scope. Two days later the machine checks what
        actually happened — did the ecosystem echo it, did it ship, did anyone follow up? This page publishes
        the result. Predictions we can&rsquo;t grade yet are shown as pending, not hidden.
      </p>

      <section className="mt-8">
        <div className="readout mb-3">score calibration — does a higher score mean it mattered?</div>
        {totalHindsight === 0 ? (
          <p className="muted text-[13px]">
            Collecting hindsight data — the first batch lands 36&ndash;60h after the rescore job starts running.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="mono w-[72px] shrink-0 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  score {b.label}
                </span>
                <div className="relative h-[14px] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-[var(--scope-1)]">
                  {b.meanHindsight !== null && (
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${Math.min(100, b.meanHindsight)}%`,
                        background: b.meanHindsight >= 50 ? 'var(--phosphor)' : 'var(--grat-strong)',
                        opacity: 0.85,
                      }}
                    />
                  )}
                </div>
                <span className="mono w-[150px] shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                  hindsight {b.meanHindsight ?? '—'} · n={b.count}
                </span>
              </div>
            ))}
            <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
              hindsight = observed follow-through (entity echoes, launches, developments, team votes), 0-100
            </p>
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="readout mb-3">forecast grades — frontier price, 30d horizon</div>
        {grades.length === 0 ? (
          <p className="muted text-[13px]">
            No forecasts stored yet — the nightly job records one per day; grades appear 30 days later.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Predicted</th>
                <th className="text-right">Realized</th>
                <th className="text-right">Error</th>
              </tr>
            </thead>
            <tbody>
              {grades.slice(0, 20).map((g) => (
                <tr key={g.date}>
                  <td className="mono text-[11px]" style={{ color: 'var(--ink-3)' }}>{g.date}</td>
                  <td className="mono text-right text-[11px]">${g.predicted.toFixed(2)}</td>
                  <td className="mono text-right text-[11px]">
                    {g.realized !== null ? `$${g.realized.toFixed(2)}` : <span style={{ color: 'var(--ink-4)' }}>pending</span>}
                  </td>
                  <td
                    className="mono text-right text-[11px]"
                    style={{
                      color:
                        g.errorPct === null
                          ? 'var(--ink-4)'
                          : Math.abs(g.errorPct) <= 20
                            ? 'var(--phosphor)'
                            : 'var(--warn)',
                    }}
                  >
                    {g.errorPct === null ? '—' : `${g.errorPct > 0 ? '+' : ''}${g.errorPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {graded.length > 0 && (
          <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
            mean abs error: {Math.round(graded.reduce((a, g) => a + Math.abs(g.errorPct ?? 0), 0) / graded.length)}%
            across {graded.length} graded forecasts
          </p>
        )}
      </section>
    </>
  );
}

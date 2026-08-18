import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import {
  accuracyMisses,
  calibrationBuckets,
  calibrationMonotonic,
  forecastGrades,
  gradingSince,
} from '@/lib/science/accuracy';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Accuracy — our track record',
  description:
    'Do our scores hold up? Score calibration against hindsight (echoes, launches, follow-ups measured 2 days later), published misses, and forecast grades. Published, not claimed.',
};

/** Expected-vs-observed: the diagonal is what "calibrated" looks like. */
function CalibrationChart({
  buckets,
}: {
  buckets: { label: string; meanScore: number; medianHindsight: number | null; count: number }[];
}) {
  const W = 560;
  const H = 200;
  const PAD = { top: 10, right: 12, bottom: 22, left: 30 };
  const x = (score: number) => PAD.left + (score / 100) * (W - PAD.left - PAD.right);
  const y = (h: number) => PAD.top + (1 - h / 100) * (H - PAD.top - PAD.bottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Calibration: score vs realized hindsight per band">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grat-soft)" />
          <text x={PAD.left - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
            {v}
          </text>
        </g>
      ))}
      {/* the ideal: score == hindsight */}
      <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke="var(--grat-strong)" strokeDasharray="4 4" />
      <text x={x(96)} y={y(96) - 6} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
        ideal
      </text>
      {buckets.map((b) =>
        b.medianHindsight === null ? null : (
          <g key={b.label}>
            <circle cx={x(b.meanScore)} cy={y(b.medianHindsight)} r={6} fill="var(--phosphor)" fillOpacity={0.85} />
            <text
              x={x(b.meanScore)}
              y={y(b.medianHindsight) - 11}
              textAnchor="middle"
              fontSize={10}
              fill="var(--ink-2)"
              fontFamily="var(--font-readout)"
            >
              {b.label} · n={b.count}
            </text>
          </g>
        ),
      )}
      <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
        score at curation →
      </text>
      <text x={PAD.left - 22} y={PAD.top + 4} fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)" transform={`rotate(-90 ${PAD.left - 22} ${PAD.top + 4})`}>
        hindsight →
      </text>
    </svg>
  );
}

function MissList({
  label,
  tone,
  misses,
  kind,
}: {
  label: string;
  tone: 'amber' | 'phosphor';
  misses: { id: number; title: string; topScore: number; hindsight: number }[];
  kind: 'over' | 'under';
}) {
  if (misses.length === 0) return null;
  return (
    <div>
      <div className="readout mb-2" style={{ color: tone === 'amber' ? 'var(--amber)' : 'var(--phosphor)' }}>
        {label}
      </div>
      <ul>
        {misses.map((m) => (
          <li key={m.id} className="border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0">
            <Link href={`/story/${m.id}`} className="block leading-snug hover:underline" style={{ color: 'var(--ink-2)' }}>
              {m.title}
            </Link>
            <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
              scored {m.topScore}
              {kind === 'over' ? ' → hindsight ' : ' → hindsight '}
              <span style={{ color: kind === 'over' ? 'var(--amber)' : 'var(--phosphor)' }}>{m.hindsight}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const monotonic = calibrationMonotonic(buckets);
  const since = gradingSince();
  const misses = accuracyMisses();

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <PageHeader
        kicker="the track record, graded in public"
        title="Accuracy"
        description={
          <>
            Every story gets a relevance score when it is published. Two days later the machine checks what
            actually happened — did the ecosystem echo it, did it ship, did anyone follow up? This page publishes
            the result, misses included. Predictions we can&rsquo;t grade yet are shown as pending, not hidden.
          </>
        }
      />
      {since && (
        <p className="mono mt-2 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
          grading since {since} &middot; {totalHindsight} stories graded &middot; times in UTC
        </p>
      )}

      <section className="mt-8">
        <div className="readout mb-1.5">score calibration — does a higher score mean it mattered?</div>
        <p className="mono mb-3 text-[10.5px]" style={{ color: monotonic ? 'var(--phosphor)' : 'var(--amber)' }}>
          {monotonic
            ? 'calibration: monotonic — higher scores are following through'
            : `calibration: not yet monotonic — early data, small n per band${since ? ` (grading since ${since})` : ''}`}
        </p>
        {totalHindsight === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
            Collecting hindsight data — the first batch lands 36&ndash;60h after the rescore job starts running.
          </p>
        ) : (
          <>
            <CalibrationChart buckets={buckets} />
            <div className="mt-4 flex flex-col gap-2.5">
              {buckets.map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="mono w-[80px] shrink-0 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                    score {b.label}
                  </span>
                  <div className="relative h-[14px] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-[var(--scope-1)]">
                    {b.medianHindsight !== null && (
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{
                          width: `${Math.min(100, b.medianHindsight)}%`,
                          background: b.medianHindsight >= 50 ? 'var(--phosphor)' : 'var(--grat-strong)',
                          opacity: 0.85,
                        }}
                      />
                    )}
                  </div>
                  <span className="mono w-[220px] shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                    median {b.medianHindsight ?? '—'} &middot; mean {b.meanHindsight ?? '—'} &middot; n={b.count}
                  </span>
                </div>
              ))}
              <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                hindsight = observed follow-through (entity echoes, launches, developments, team votes), 0-100
              </p>
            </div>
          </>
        )}
      </section>

      {(misses.overRated.length > 0 || misses.underRated.length > 0) && (
        <section className="mt-10 grid gap-8 md:grid-cols-2">
          <MissList label="we over-rated" tone="amber" misses={misses.overRated} kind="over" />
          <MissList label="we under-rated" tone="phosphor" misses={misses.underRated} kind="under" />
        </section>
      )}

      <section className="mt-10">
        <div className="readout mb-3">forecast grades — frontier price, 30d horizon</div>
        {grades.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
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

      <div className="mt-9 border-t border-[var(--grat-soft)] pt-3">
        <p className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
          nothing on this page is cherry-picked &middot; misses stay published
        </p>
      </div>
    </div>
  );
}

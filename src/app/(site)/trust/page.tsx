import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import {
  accuracyMisses,
  calibrationBuckets,
  calibrationMonotonic,
  calibrationPoints,
  forecastGrades,
  gradingSince,
  pendingGrades,
  spearman,
} from '@/lib/science/accuracy';
import { freshnessStats } from '@/lib/freshness';
import { paths } from '@/lib/urls';

export const metadata = {
  title: 'Trust — accuracy & methodology',
  description:
    'Do our scores hold up? Scoring parameters, calibration scatter, published misses, and forecast grades. Methodology in public — published, not claimed.',
};

/** The curation rubric — mirrors the scoring bands in lib/curate/curate.ts. */
const RUBRIC: { range: string; label: string; gloss: string }[] = [
  { range: '80–100', label: 'critical', gloss: 'act now — major launch, pricing shift, capability jump' },
  { range: '60–79', label: 'important', gloss: 'changes tool or technique choice in that domain' },
  { range: '40–59', label: 'relevant', gloss: 'worth a look for teams working in that domain' },
  { range: '20–39', label: 'tangential', gloss: 'background awareness only' },
  { range: '0–19', label: 'irrelevant', gloss: 'auto-filtered at curation, never shown' },
];

/** The hindsight weights — mirrors lib/science/hindsight.ts (bar scale: 30 = full width). */
const HINDSIGHT_PARTS: { name: string; weight: string; pct: string; gloss: string }[] = [
  { name: 'entity echo', weight: '≤30', pct: '100%', gloss: 'later stories mention the same entities · 5+ = full marks' },
  { name: 'launch materialized', weight: '25', pct: '83%', gloss: 'a tracked launch (Show HN / Product Hunt) ships a named entity' },
  { name: 'follow-through', weight: '≤25', pct: '83%', gloss: 'later stories develop the same topic · 5+ = full marks' },
  { name: 'team votes', weight: '±15', pct: '50%', gloss: '(up − down) × 5 — the human override' },
];

/**
 * Every graded story as a dot (score at publish × hindsight two days later),
 * band medians traced on top, split by the feed's own bands. Dot overdraw
 * shows density; integer scores pile honestly. No "ideal" diagonal — the
 * hypothesis under test is monotonic rise, not score == hindsight.
 */
function CalibrationScatter({
  points,
  medians,
}: {
  points: { score: number; hindsight: number }[];
  medians: { meanScore: number; median: number; label: string }[];
}) {
  const W = 560;
  const H = 220;
  const PAD = { top: 16, right: 14, bottom: 28, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxObserved = points.reduce((m, p) => Math.max(m, p.hindsight), 0);
  const yMax = Math.max(50, Math.ceil(maxObserved / 10) * 10);
  const x = (score: number) => PAD.left + (score / 100) * plotW;
  const y = (h: number) => PAD.top + (1 - h / yMax) * plotH;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full"
      role="img"
      aria-label="Scatter of every graded story: score at publish versus realized hindsight, with band medians traced"
    >
      {/* graticule — horizontal at 0 / mid / max */}
      {[0, yMax / 2, yMax].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grat-soft)" />
          <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
            {v}
          </text>
        </g>
      ))}
      {/* the feed's own bands: archive <40 · scan 40–69 · top signals 70+ */}
      {[40, 70].map((v) => (
        <line key={v} x1={x(v)} x2={x(v)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--grat)" strokeDasharray="3 3" />
      ))}
      {[
        { at: 20, label: 'archive' },
        { at: 55, label: 'scan' },
        { at: 85, label: 'top signals' },
      ].map((b) => (
        <text key={b.label} x={x(b.at)} y={PAD.top - 5} textAnchor="middle" fontSize={9} fill="var(--ink-4)" fontFamily="var(--font-readout)" letterSpacing="0.1em">
          {b.label}
        </text>
      ))}
      {[0, 40, 70, 100].map((v) => (
        <text key={v} x={x(v)} y={H - PAD.bottom + 13} textAnchor="middle" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
          {v}
        </text>
      ))}
      {/* every graded story */}
      {points.map((p, i) => (
        <circle key={i} cx={x(p.score)} cy={y(p.hindsight)} r={1.8} fill="var(--phosphor)" fillOpacity={0.3} />
      ))}
      {/* the hypothesis under test: band medians rise left to right */}
      {medians.length > 1 && (
        <polyline
          points={medians.map((m) => `${x(m.meanScore)},${y(m.median)}`).join(' ')}
          fill="none"
          stroke="var(--phosphor)"
          strokeWidth={1.5}
          strokeOpacity={0.6}
        />
      )}
      {medians.map((m) => (
        <g key={m.label}>
          <circle cx={x(m.meanScore)} cy={y(m.median)} r={5} fill="var(--phosphor)" stroke="var(--scope-0)" strokeWidth={2} />
          <text
            x={x(m.meanScore)}
            y={y(m.median) - 10}
            textAnchor="middle"
            fontSize={10}
            fill="var(--phosphor)"
            fontFamily="var(--font-readout)"
          >
            {m.median}
          </text>
        </g>
      ))}
      <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
        score at publish →
      </text>
      <text
        x={10}
        y={PAD.top + plotH / 2}
        fontSize={10}
        fill="var(--ink-4)"
        fontFamily="var(--font-readout)"
        textAnchor="middle"
        transform={`rotate(-90 10 ${PAD.top + plotH / 2})`}
      >
        hindsight (2 days later) →
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
            <Link href={paths.story(m.id)} className="block leading-snug hover:underline" style={{ color: 'var(--ink-2)' }}>
              {m.title}
            </Link>
            <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
              scored {m.topScore} → hindsight{' '}
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
  const points = calibrationPoints();
  const grades = forecastGrades();
  const graded = grades.filter((g) => g.realized !== null);
  const totalHindsight = buckets.reduce((n, b) => n + b.count, 0);
  const monotonic = calibrationMonotonic(buckets);
  const since = gradingSince();
  const misses = accuracyMisses();
  const pending = pendingGrades();
  const freshness = freshnessStats();
  const rho = spearman(
    points.map((p) => p.score),
    points.map((p) => p.hindsight),
  );
  const medians = buckets
    .filter((b) => b.medianHindsight !== null && b.count > 0)
    .map((b) => ({ meanScore: b.meanScore, median: b.medianHindsight!, label: b.label }));
  const oldestForecast = grades[grades.length - 1];
  const firstGradeLands = oldestForecast
    ? new Date(new Date(`${oldestForecast.date}T00:00:00Z`).getTime() + 30 * 864e5).toISOString().slice(0, 10)
    : null;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-12 sm:px-6">
      <div className="readout text-phosphor">Trust · accuracy & methodology</div>
      <h1 className="type-h1 mt-2">Published, not claimed</h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-2">
        Every story gets a score at publish — one LLM call grading relevance against a fixed rubric. 36–60 hours
        later the machine grades what actually happened — did the ecosystem echo it, did it ship, did anyone
        follow up. This page publishes the comparison, misses included, and the misses feed back into the
        scorer. Predictions we can&rsquo;t grade yet are shown as pending, not hidden.
      </p>
      <p className="mt-2 text-[12.5px] text-ink-4">
        Formerly <span className="mono">/accuracy</span> — same track record, now the public trust surface.
      </p>

      {/* The independence claim made on the landing page and pricing page has to
          be substantiated somewhere. This is that somewhere. */}
      <div className="mt-6 space-y-3 border-l-2 border-phosphor/40 pl-4 text-[13px] leading-relaxed text-ink-2">
        <p>
          <span className="text-ink">Nobody pays us to recommend anything.</span> No affiliate links, no
          sponsorships, no paid placements, no vendor money in any form. When a verdict on the board changes, it is
          because the evidence changed — and the change is logged with a date you can go and look at.
        </p>
        <p>
          <span className="text-ink">Verdicts are dated, and gaps are left visible.</span> Every board cell carries
          the date it was last reviewed. Where we do not have evidence we are willing to stand behind, the cell stays
          empty and says why, rather than being filled with a plausible-sounding pick. There is at least one blank
          cell on the board right now, on purpose.
        </p>
        <p>
          <span className="text-ink">We round down, not up.</span> Every savings figure we publish comes from a
          seeded benchmark and is rounded down before it reaches a page, so the number you read is the floor rather
          than a good day.
        </p>
      </div>
      {since && (
        <p className="mono mt-2 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
          grading since {since} &middot; {totalHindsight} graded &middot; {pending} pending &middot; times in UTC
        </p>
      )}

      <section className="mt-8">
        <div className="readout mb-3">how the scoring works — the parameters</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card">
            <div className="readout" style={{ color: 'var(--ink-3)' }}>
              the prediction — at publish
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {RUBRIC.map((r) => (
                <li key={r.range} className="flex items-baseline gap-3 text-[12px]">
                  <span className="mono w-[52px] shrink-0 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                    {r.range}
                  </span>
                  <span style={{ color: 'var(--ink-3)' }}>
                    <span style={{ color: 'var(--ink)' }}>{r.label}</span> — {r.gloss}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-[var(--grat-soft)] pt-2.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
              One MiniMax call per story scores six domains — coding, copy, image, video, ads, agentic — and the
              story&rsquo;s score is the highest. Calibrated by recent team votes, source priors, and our own
              misses below.
            </p>
            <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
              ≥70 top signals &middot; 40–69 scan log &middot; &lt;40 archive
            </p>
          </div>
          <div className="card">
            <div className="readout" style={{ color: 'var(--ink-3)' }}>
              the grade — hindsight, 36–60h later
            </div>
            <ul className="mt-3 flex flex-col gap-2.5">
              {HINDSIGHT_PARTS.map((c) => (
                <li key={c.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="mono text-[11px]" style={{ color: 'var(--ink-2)' }}>
                      {c.name}
                    </span>
                    <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                      {c.weight}
                    </span>
                  </div>
                  <div className="mt-1 h-[3px] overflow-hidden rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
                    <div className="anim-bar h-full rounded-[1px]" style={{ width: c.pct, background: 'var(--phosphor)', opacity: 0.8 }} />
                  </div>
                  <div className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-4)' }}>
                    {c.gloss}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-[var(--grat-soft)] pt-2.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
              No LLM at grading — observed signals only. Each story is graded once; the grade never changes.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="readout mb-1.5">score calibration — does a higher score mean it mattered?</div>
        {totalHindsight === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
            Collecting hindsight data — the first batch lands 36&ndash;60h after the rescore job starts running.
          </p>
        ) : (
          <>
            <p className="mono mb-3 text-[10.5px]" style={{ color: monotonic ? 'var(--phosphor)' : 'var(--amber)' }}>
              {monotonic
                ? 'calibration: monotonic — higher scores are following through'
                : 'calibration: not yet monotonic — early data, small n per band'}
              {rho !== null && ` · ρ ${rho.toFixed(2)} · n=${totalHindsight}`}
            </p>
            <CalibrationScatter points={points} medians={medians} />
            <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
              <span style={{ color: 'var(--phosphor)' }}>●</span> one graded story &nbsp;
              <span style={{ color: 'var(--phosphor)' }}>—●—</span> band medians (value = median hindsight) &nbsp;&middot;&nbsp;
              verticals: the feed&rsquo;s score bands
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {buckets.map((b) => (
                <div key={b.label} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="mono shrink-0 text-[11px] sm:w-[80px]" style={{ color: 'var(--ink-3)' }}>
                    score {b.label}
                  </span>
                  <div className="relative h-[14px] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-[var(--scope-1)]">
                    {b.medianHindsight !== null && (
                      <div
                        key={b.medianHindsight}
                        className="anim-bar absolute inset-y-0 left-0"
                        style={{
                          width: `${Math.min(100, b.medianHindsight)}%`,
                          background: b.medianHindsight >= 50 ? 'var(--phosphor)' : 'var(--grat-strong)',
                          opacity: 0.85,
                        }}
                      />
                    )}
                  </div>
                  <span className="mono shrink-0 text-[10.5px] sm:w-[250px] sm:text-right" style={{ color: 'var(--ink-3)' }}>
                    median {b.medianHindsight ?? '—'} &middot; mean {b.meanHindsight ?? '—'} &middot; n={b.count} &middot;{' '}
                    {b.followThroughRate}% followed
                  </span>
                </div>
              ))}
              <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                bar = median hindsight &middot; % followed = stories with any follow-through at all (hindsight &gt; 0)
              </p>
            </div>
          </>
        )}
      </section>

      {(misses.overRated.length > 0 || misses.underRated.length > 0) && (
        <section className="mt-10">
          <div className="readout mb-1.5">the misses — published, and fed back into the scorer</div>
          <p className="mb-4 text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            These stories are shown to the scoring model as calibration: over-rates teach it to discount hype,
            under-rates to notice quiet signal.
          </p>
          <div className="grid gap-8 md:grid-cols-2">
            <MissList label="we over-rated" tone="amber" misses={misses.overRated} kind="over" />
            <MissList label="we under-rated" tone="phosphor" misses={misses.underRated} kind="under" />
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="readout mb-1.5">forecast grades — frontier price, 30d horizon</div>
        <p className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Every night we record the projected price of frontier intelligence — cheapest blended $/1M tokens among
          models within 90% of the day&rsquo;s intelligence ceiling (Artificial Analysis), from a log-linear fit,
          30 days out. Realized = the actual frontier price on the target date.
        </p>
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
        {graded.length === 0 && firstGradeLands && grades.length > 0 && (
          <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
            first grade lands {firstGradeLands} — a forecast is graded when its 30d target passes
          </p>
        )}
        {graded.length > 0 && (
          <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
            mean abs error: {Math.round(graded.reduce((a, g) => a + Math.abs(g.errorPct ?? 0), 0) / graded.length)}%
            across {graded.length} graded forecasts
          </p>
        )}
      </section>

      <section className="mt-10">
        <div className="readout mb-1.5">freshness — how fast the radar reflects what happens</div>
        <p className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Ingest and curation run every 15 minutes, so the feed trails a release by minutes, not days. The slower
          hop is the board: a story counts as reflected when a board change names one of its entities. Medians over
          the last {freshness.windowDays} days.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card">
            <div className="readout" style={{ color: 'var(--ink-3)' }}>
              story → board
            </div>
            {freshness.boardReflection.medianHours === null ? (
              <p className="mt-3 text-[13px]" style={{ color: 'var(--ink-3)' }}>
                Nothing to measure yet — this number appears once curated stories with entities meet matching board
                changes.
              </p>
            ) : (
              <>
                <div className="mono mt-2 text-[26px] leading-none" style={{ color: 'var(--phosphor)' }}>
                  {freshness.boardReflection.medianHours}h
                </div>
                <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  median lag &middot; {freshness.boardReflection.matched} of {freshness.boardReflection.considered}{' '}
                  stories with entities reflected
                </p>
              </>
            )}
          </div>
          <div className="card">
            <div className="readout" style={{ color: 'var(--ink-3)' }}>
              story → merge
            </div>
            {freshness.mergeLag.medianMinutes === null ? (
              <p className="mt-3 text-[13px]" style={{ color: 'var(--ink-3)' }}>
                No merges recorded yet — this number appears once new items start merging into existing stories.
              </p>
            ) : (
              <>
                <div className="mono mt-2 text-[26px] leading-none" style={{ color: 'var(--phosphor)' }}>
                  {freshness.mergeLag.medianMinutes}m
                </div>
                <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  median, story appears → latest item merged &middot; n={freshness.mergeLag.count}
                </p>
              </>
            )}
          </div>
        </div>
        <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
          methodology: story→board matches a story&rsquo;s entity names against board-change text (case-insensitive;
          first match at/after the story appeared) — a heuristic, so the matched pairs are kept for spot checks.
          story→merge uses the latest merge timestamp, so it overstates time-to-first-merge.
        </p>
        {freshness.boardReflection.pairs.length > 0 && (
          <ul className="mt-3">
            {freshness.boardReflection.pairs.slice(0, 3).map((p) => (
              <li
                key={`${p.storyId}-${p.appliedAt.toISOString()}`}
                className="border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
              >
                <Link href={paths.story(p.storyId)} className="block leading-snug hover:underline" style={{ color: 'var(--ink-2)' }}>
                  {p.storyTitle}
                </Link>
                <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  → {p.change.length > 90 ? `${p.change.slice(0, 90)}…` : p.change} &middot;{' '}
                  <span style={{ color: 'var(--ink-3)' }}>{p.lagHours}h</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <div className="readout mb-1.5">how we score ourselves</div>
        <div className="card flex flex-col gap-2.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          <p>
            Every night the machine grades its own output: each curated story gets a hindsight score from observed
            signals only — echoes, launches, follow-ups, team votes — with no LLM at grading, and the grade never
            changes once written. The scatter and bands above are that reckoning, in full.
          </p>
          <p>
            Forecasts get the same treatment: the nightly frontier-price projection is stored, then graded against
            the realized price 30 days later — the table above, pending shown rather than hidden.
          </p>
          <p>
            When prediction and outcome diverge badly, the miss is published on this page, investigated, and fed
            back into the scorer as calibration — not silently accepted.
          </p>
        </div>
      </section>

      <section className="mt-10">
        <div className="readout mb-1.5">independence</div>
        <div className="card text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          <p>
            No pay-for-placement: nobody can buy a board slot, a feed rank, or a score. Board picks are
            model-driven — proposed by the pipeline from the signals on this page — and re-reviewed weekly.
            Sponsors and affiliates: none.
          </p>
        </div>
      </section>

      <div className="mt-9 border-t border-[var(--grat-soft)] pt-3">
        <p className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
          nothing on this page is cherry-picked &middot; misses stay published
        </p>
      </div>
    </div>
  );
}

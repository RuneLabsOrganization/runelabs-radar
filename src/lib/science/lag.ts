import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { metricPoints } from '../db/schema';
import { correlationSignificant } from '../stats';
import { CROSS_CORRELATE_MIN_OVERLAP, crossCorrelate } from './math';

const MAX_LAG = 10;
/** Ready only when a fixed-window coefficient is even computable: maxLag + min overlap. */
export const LAG_MIN_DAYS = MAX_LAG + CROSS_CORRELATE_MIN_OVERLAP;
/** 11 lags × 2 directions — both are tested, so both count as hypotheses. */
const COMPARISONS = 2 * (MAX_LAG + 1);

export interface LagReadiness {
  days: number;
  needed: number;
  ready: boolean;
}

/** How many days of launch-category history exist — the binding series for lag work. */
export function lagReadiness(): LagReadiness {
  const db = getDb();
  const rows = db
    .select({ date: metricPoints.date })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'launches'), eq(metricPoints.metric, 'count')))
    .all();
  const days = new Set(rows.map((r) => r.date)).size;
  return { days, needed: LAG_MIN_DAYS, ready: days >= LAG_MIN_DAYS };
}

export interface LagFinding {
  leader: string;
  follower: string;
  lagDays: number;
  coefficient: number;
  /** paired real days behind the coefficient (inner join — no zero-fill) */
  n: number;
  /** Bonferroni-adjusted |r| bar the coefficient cleared (11 lags × 2 directions) */
  threshold: number;
}

function dailySeries(source: string, entity: string, metric: string): Map<string, number> {
  const db = getDb();
  const rows = db
    .select()
    .from(metricPoints)
    .where(and(eq(metricPoints.source, source), eq(metricPoints.entity, entity), eq(metricPoints.metric, metric)))
    .all();
  return new Map(rows.map((r) => [r.date, r.value]));
}

/**
 * Pair the series on their SHARED real dates only. Zero-filling days one
 * series is missing fabricates synchronized dip-and-recover shapes that
 * correlate artificially — a gap is absence of evidence, not a zero.
 */
function aligned(a: Map<string, number>, b: Map<string, number>): { a: number[]; b: number[] } {
  const dates = [...a.keys()].filter((d) => b.has(d)).sort();
  return {
    a: dates.map((d) => a.get(d) ?? 0),
    b: dates.map((d) => b.get(d) ?? 0),
  };
}

/** Candidate leader→follower pairs: capability activity vs launch waves. */
const PAIRS: { leader: [string, string, string]; follower: [string, string, string]; label: [string, string] }[] = [
  {
    leader: ['launches', 'ai-media', 'count'],
    follower: ['launches', 'ai-content', 'count'],
    label: ['ai-media launches', 'ai-content launches'],
  },
  {
    leader: ['launches', 'agents', 'count'],
    follower: ['launches', 'saas-tools', 'count'],
    label: ['agent launches', 'saas-tool launches'],
  },
];

/**
 * |r| that clears correlationSignificant's Fisher bar for n points — the
 * inverse of its test, reported so a finding can show the bar it cleared.
 */
function criticalR(n: number, comparisons: number): number {
  if (n < 4) return 1;
  const penalty = comparisons > 1 ? Math.sqrt(Math.log(comparisons) / Math.log(2)) : 1;
  return Math.tanh((1.96 * penalty) / Math.sqrt(n - 3));
}

/**
 * Release→launch lag findings. Returns [] until enough history exists; the
 * UI shows the warming-up meter from lagReadiness() instead.
 *
 * Publication requires correlationSignificant (Fisher z + Bonferroni over 11
 * lags × 2 directions) — the old r≥0.4 best-of-11 bar published noise. The
 * direction is a hypothesis, not an assumption: each pair is tested
 * leader→follower AND follower→leader, and the stronger significant
 * direction wins.
 */
export function lagFindings(): LagFinding[] {
  if (!lagReadiness().ready) return [];
  const out: LagFinding[] = [];
  for (const pair of PAIRS) {
    const s = aligned(dailySeries(...pair.leader), dailySeries(...pair.follower));
    const forward = crossCorrelate(s.a, s.b, MAX_LAG);
    const reverse = crossCorrelate(s.b, s.a, MAX_LAG);
    const candidates: { lag: number; coefficient: number; n: number; labels: [string, string] }[] = [];
    // positive correlation only — an anti-correlated pair is not "X leads Y"
    if (forward && forward.lag > 0 && forward.coefficient > 0) candidates.push({ ...forward, labels: pair.label });
    if (reverse && reverse.lag > 0 && reverse.coefficient > 0)
      candidates.push({ ...reverse, labels: [pair.label[1], pair.label[0]] });
    const best = candidates.sort((x, y) => y.coefficient - x.coefficient)[0];
    if (best && correlationSignificant(best.coefficient, best.n, COMPARISONS)) {
      out.push({
        leader: best.labels[0],
        follower: best.labels[1],
        lagDays: best.lag,
        coefficient: best.coefficient,
        n: best.n,
        threshold: criticalR(best.n, COMPARISONS),
      });
    }
  }
  return out;
}

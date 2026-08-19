import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { metricPoints } from '../db/schema';
import { crossCorrelate } from './math';

export const LAG_MIN_DAYS = 21;
const MAX_LAG = 10;

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

function aligned(a: Map<string, number>, b: Map<string, number>): { a: number[]; b: number[] } {
  const dates = [...new Set([...a.keys(), ...b.keys()])].sort();
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
 * Release→launch lag findings. Returns [] until enough history exists; the
 * UI shows the warming-up meter from lagReadiness() instead.
 */
export function lagFindings(): LagFinding[] {
  if (!lagReadiness().ready) return [];
  const out: LagFinding[] = [];
  for (const pair of PAIRS) {
    const s = aligned(dailySeries(...pair.leader), dailySeries(...pair.follower));
    const best = crossCorrelate(s.a, s.b, MAX_LAG);
    // positive correlation only — an anti-correlated pair is not "X leads Y"
    if (best && best.coefficient >= 0.4 && best.lag > 0) {
      out.push({
        leader: pair.label[0],
        follower: pair.label[1],
        lagDays: best.lag,
        coefficient: best.coefficient,
      });
    }
  }
  return out;
}

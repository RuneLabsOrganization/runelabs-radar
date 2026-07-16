import { and, desc, eq, gte } from 'drizzle-orm';
import { dailyDomainCounts, topEntities } from '../analytics';
import { getDb } from '../db';
import { metricPoints, painPoints, patterns, topicClusters } from '../db/schema';
import { DOMAIN_LABELS, isDomain } from '../domains';
import { chatJSON } from '../llm/minimax';
import { utcDay } from '../metrics';
import { zScore } from './math';

const MAX_PATTERNS = 8;

export interface RawDetection {
  kind: 'sector-spike' | 'entity-surge' | 'price-drop' | 'launch-spike' | 'cluster-heat' | 'pain-cluster';
  subject: string;
  /** template narration — used verbatim when the LLM polish fails */
  fallback: string;
  score: number;
  evidence: { label: string }[];
}

/** Sector volume today vs the trailing baseline (needs ≥5 days of history). */
export function detectSectorSpikes(): RawDetection[] {
  const days = dailyDomainCounts(21);
  if (days.length < 6) return [];
  const out: RawDetection[] = [];
  const today = days[days.length - 1];
  for (const [domain, count] of Object.entries(today.byDomain)) {
    const baseline = days.slice(0, -1).map((d) => d.byDomain[domain as keyof typeof d.byDomain]);
    const nonzeroDays = baseline.filter((v) => v > 0).length;
    if (nonzeroDays < 5 || count < 3) continue;
    const z = zScore(count, baseline);
    if (z >= 2) {
      const label = isDomain(domain) ? DOMAIN_LABELS[domain] : domain;
      out.push({
        kind: 'sector-spike',
        subject: domain,
        fallback: `${label} sector running ${z.toFixed(1)}σ above its 3-week baseline (${count} stories today).`,
        score: z,
        evidence: [{ label: `${count} stories today vs baseline` }],
      });
    }
  }
  return out;
}

/** Entities mentioned far more this week than last. */
export function detectEntitySurges(): RawDetection[] {
  const out: RawDetection[] = [];
  for (const e of topEntities(15)) {
    const surged = e.prev === 0 ? e.count >= 5 : e.count >= 4 && e.count / e.prev >= 3;
    if (!surged) continue;
    const ratio = e.prev === 0 ? e.count : e.count / e.prev;
    out.push({
      kind: 'entity-surge',
      subject: e.name,
      fallback:
        e.prev === 0
          ? `${e.name} appeared from nowhere: ${e.count} mentions this week, zero last week.`
          : `${e.name} mentions up ${Math.round(ratio)}× week-over-week (${e.prev} → ${e.count}).`,
      score: ratio,
      evidence: [{ label: `${e.count} mentions (prev ${e.prev})` }],
    });
  }
  return out;
}

/** Model price drops between the two most recent snapshot days (≥15%). */
export function detectPriceDrops(): RawDetection[] {
  const db = getDb();
  const rows = db
    .select()
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'aa'), eq(metricPoints.metric, 'price_blended')))
    .orderBy(desc(metricPoints.date))
    .all();
  const byEntity = new Map<string, { date: string; value: number }[]>();
  for (const r of rows) {
    const list = byEntity.get(r.entity) ?? [];
    list.push({ date: r.date, value: r.value });
    byEntity.set(r.entity, list);
  }
  const out: RawDetection[] = [];
  for (const [entity, series] of byEntity) {
    if (series.length < 2) continue; // needs at least two snapshot days
    const [latest, prev] = series; // desc order
    if (latest.date === prev.date || prev.value <= 0) continue;
    const drop = (prev.value - latest.value) / prev.value;
    if (drop >= 0.15) {
      out.push({
        kind: 'price-drop',
        subject: entity,
        fallback: `${entity} blended price dropped ${(drop * 100).toFixed(0)}% (${prev.value} → ${latest.value} $/1M) — margin math just changed.`,
        score: drop * 10,
        evidence: [{ label: `$${prev.value} → $${latest.value} per 1M` }],
      });
    }
  }
  return out;
}

/** Launch-category volume spikes vs trailing history (needs ≥6 days of counts). */
export function detectLaunchSpikes(): RawDetection[] {
  const db = getDb();
  const rows = db
    .select()
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'launches'), eq(metricPoints.metric, 'count')))
    .all();
  const byCat = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byCat.get(r.entity) ?? new Map<string, number>();
    m.set(r.date, r.value);
    byCat.set(r.entity, m);
  }
  const today = utcDay();
  const out: RawDetection[] = [];
  for (const [cat, byDate] of byCat) {
    const dates = [...byDate.keys()].sort();
    if (dates.length < 6) continue;
    const todayCount = byDate.get(today);
    if (todayCount === undefined || todayCount < 4) continue;
    const baseline = dates.filter((d) => d !== today).map((d) => byDate.get(d) ?? 0);
    const z = zScore(todayCount, baseline);
    if (z >= 2) {
      out.push({
        kind: 'launch-spike',
        subject: cat,
        fallback: `${cat} launches spiking: ${todayCount} today, ${z.toFixed(1)}σ above baseline — a wave is forming.`,
        score: z,
        evidence: [{ label: `${todayCount} launches today` }],
      });
    }
  }
  return out;
}

/** The hottest semantic cluster, when it's substantial. */
export function detectClusterHeat(): RawDetection[] {
  const db = getDb();
  const hot = db
    .select()
    .from(topicClusters)
    .orderBy(desc(topicClusters.heat))
    .limit(1)
    .get();
  if (!hot || hot.size < 5 || hot.heat < 0.999) return [];
  return [
    {
      kind: 'cluster-heat',
      subject: hot.label,
      fallback: `"${hot.label}" is the hottest topic on the scope right now (${hot.size} stories, peak recency-weighted activity).`,
      score: 2 + hot.size / 10,
      evidence: [{ label: `${hot.size} stories in cluster` }],
    },
  ];
}

/** Recurring pains — the demand signal compounding. */
export function detectPainClusters(): RawDetection[] {
  const db = getDb();
  const recurring = db
    .select()
    .from(painPoints)
    .where(and(gte(painPoints.intensity, 3), gte(painPoints.lastSeenAt, new Date(Date.now() - 7 * 864e5))))
    .orderBy(desc(painPoints.intensity))
    .limit(3)
    .all();
  return recurring.map((p) => ({
    kind: 'pain-cluster' as const,
    subject: p.summary,
    fallback: `Recurring unmet need (seen ${p.intensity}×): ${p.summary}${p.sector ? ` [${p.sector}]` : ''}.`,
    score: p.intensity,
    evidence: [{ label: `observed ${p.intensity} times` }],
  }));
}

/** Validates LLM narration; falls back per-detection. Exported for tests. */
export function sanitizeNarrations(
  v: unknown,
  count: number,
): Map<number, { headline: string; detail: string }> {
  const out = new Map<number, { headline: string; detail: string }>();
  if (typeof v !== 'object' || v === null) return out;
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.headline !== 'string' || typeof rec.detail !== 'string') continue;
    const headline = rec.headline.trim().slice(0, 110);
    const detail = rec.detail.trim().slice(0, 300);
    if (!headline || !detail) continue;
    out.set(idx, { headline, detail });
  }
  return out;
}

/**
 * Daily anomaly sweep: run all detectors, keep the strongest, narrate with
 * one LLM call (template fallback), replace today's patterns.
 */
export async function runAnomalies(): Promise<{ patterns: number }> {
  const detections = [
    ...detectSectorSpikes(),
    ...detectEntitySurges(),
    ...detectPriceDrops(),
    ...detectLaunchSpikes(),
    ...detectClusterHeat(),
    ...detectPainClusters(),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PATTERNS);

  if (detections.length === 0) return { patterns: 0 };

  let narrations = new Map<number, { headline: string; detail: string }>();
  try {
    const system =
      'You narrate anomaly detections for Runelabs Radar — an analyst voice, concrete and ' +
      'actionable, never breathless. For each detection: "headline" (max ~12 words, the finding) ' +
      'and "detail" (1-2 sentences: what it means for a team shipping AI products, what to do). ' +
      'Respond with STRICT JSON only: {"patterns":{"<index>":{"headline":"...","detail":"..."}}}';
    const user = detections.map((d, i) => `[${i}] (${d.kind}) ${d.fallback}`).join('\n');
    const res = await chatJSON<{ patterns?: unknown }>(system, user);
    narrations = sanitizeNarrations(res.patterns, detections.length);
  } catch (e) {
    console.error('[science] narration failed, using template text:', e);
  }

  const db = getDb();
  const today = utcDay();
  db.delete(patterns).where(eq(patterns.date, today)).run();
  detections.forEach((d, i) => {
    const n = narrations.get(i);
    db.insert(patterns)
      .values({
        kind: d.kind,
        headline: n?.headline ?? d.fallback,
        detail: n?.detail ?? d.fallback,
        score: d.score,
        evidence: JSON.stringify(d.evidence),
        date: today,
        createdAt: new Date(),
      })
      .run();
  });
  return { patterns: detections.length };
}

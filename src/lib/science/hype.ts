import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { metricPoints } from '../db/schema';
import { topEntities } from '../analytics';

export interface HypeEntry {
  name: string;
  /** story mentions in the last 7d */
  mentions: number;
  /** observed artifacts in the last 7d: github star delta + hf download delta + npm weekly downloads */
  artifacts: number;
  /** 0 = quiet substance, 100 = pure hype. Heuristic v1. null = no artifact series matched (no data, not max hype). */
  score: number | null;
}

/**
 * Hype-vs-substance: how loud an entity is vs how much real stuff it shipped.
 * mentions_7d come from curated stories; artifacts from the velocity job's
 * metric points (github stars, HF downloads, npm weekly downloads), matched
 * by name containment ("comfyui" ⊂ "comfyanonymous/ComfyUI").
 *
 * score = 100 · mentions / (mentions + 3 · log10(1 + artifacts))
 * — log scale keeps one viral download spike from drowning everything;
 * an entity with matched series but zero artifact movement scores 100
 * (pure hype). An entity with NO matched artifact series scores null —
 * absence of data must not read as maximum hype.
 */
export function hypeIndex(limit = 12): HypeEntry[] {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

  return topEntities(limit).map((e) => {
    const needle = e.name.toLowerCase();
    if (needle.length < 3) return { name: e.name, mentions: e.count, artifacts: 0, score: null };

    // matched series across the velocity sources
    const series = db
      .select({
        source: metricPoints.source,
        entity: metricPoints.entity,
        metric: metricPoints.metric,
        latest: sql<number>`max(${metricPoints.value})`,
        earliest: sql<number>`min(${metricPoints.value})`,
      })
      .from(metricPoints)
      .where(
        and(
          gte(metricPoints.date, weekAgo),
          sql`lower(${metricPoints.entity}) LIKE ${'%' + needle + '%'}`,
          sql`${metricPoints.metric} IN ('stars','downloads','weekly_downloads')`,
        ),
      )
      .groupBy(metricPoints.source, metricPoints.entity, metricPoints.metric)
      .all();

    if (series.length === 0) return { name: e.name, mentions: e.count, artifacts: 0, score: null };

    let artifacts = 0;
    for (const s of series) {
      // npm weekly_downloads is already a rate — count it directly;
      // stars/hf downloads are cumulative — count the weekly delta
      artifacts += s.metric === 'weekly_downloads' ? s.latest : Math.max(0, s.latest - s.earliest);
    }

    const substance = Math.log10(1 + artifacts);
    const score = Math.round((100 * e.count) / (e.count + 3 * substance));
    return { name: e.name, mentions: e.count, artifacts, score };
  });
}

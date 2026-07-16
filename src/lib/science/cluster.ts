import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { getDb } from '../db';
import { stories, topicClusters } from '../db/schema';
import { bufferToVec, vecToBuffer } from '../vec';
import { chatJSON } from '../llm/minimax';
import { utcDay } from '../metrics';
import { kmeans, pca2d } from './math';

const WINDOW_DAYS = 14;
const MIN_STORIES = 12;

export interface ClusterLabel {
  label: string;
  summary: string | null;
}

/** Validates the LLM's cluster labels. Exported for tests. */
export function sanitizeClusterLabels(v: unknown, k: number): Map<number, ClusterLabel> {
  const out = new Map<number, ClusterLabel>();
  if (typeof v !== 'object' || v === null) return out;
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= k) continue;
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.label !== 'string' || rec.label.trim() === '') continue;
    out.set(idx, {
      label: rec.label.trim().slice(0, 40),
      summary: typeof rec.summary === 'string' ? rec.summary.trim().slice(0, 160) : null,
    });
  }
  return out;
}

/**
 * Daily semantic clustering: k-means over the last 14 days of embedded
 * stories, PCA 2D projection for the map, recency-weighted heat, one LLM
 * call for labels. topic_clusters holds the latest run only (replace-all).
 */
export async function runClustering(): Promise<{ clusters: number; mapped: number }> {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const rows = db
    .select({
      id: stories.id,
      title: stories.title,
      embedding: stories.embedding,
      createdAt: stories.createdAt,
    })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNotNull(stories.embedding), gte(stories.createdAt, since)))
    .all();

  if (rows.length < MIN_STORIES) {
    console.warn(`[science] clustering skipped — ${rows.length}/${MIN_STORIES} embedded stories in window`);
    return { clusters: 0, mapped: 0 };
  }

  const vectors = rows.map((r) => bufferToVec(r.embedding as Buffer));
  const k = Math.max(4, Math.min(12, Math.round(Math.sqrt(rows.length / 2))));
  const { assignments, centroids } = kmeans(vectors, k);
  const coords = pca2d(vectors);

  // recency-weighted heat per cluster, normalized to max=1
  const heat = new Array<number>(k).fill(0);
  const size = new Array<number>(k).fill(0);
  const now = Date.now();
  rows.forEach((r, i) => {
    const c = assignments[i];
    size[c]++;
    heat[c] += Math.exp(-((now - r.createdAt.getTime()) / 864e5) / 3);
  });
  const maxHeat = Math.max(1e-9, ...heat);

  // one LLM call for labels; template fallback keeps the run alive
  const byCluster = new Map<number, string[]>();
  rows.forEach((r, i) => {
    const list = byCluster.get(assignments[i]) ?? [];
    if (list.length < 6) list.push(r.title);
    byCluster.set(assignments[i], list);
  });
  let labels = new Map<number, ClusterLabel>();
  try {
    const system =
      'You label semantic clusters of AI-news stories. For each cluster give a specific, ' +
      'concrete topic label (max 5 words — name the actual subject, not "AI news") and a ' +
      'one-line summary. Respond with STRICT JSON only: ' +
      '{"clusters":{"<index>":{"label":"...","summary":"..."}}}';
    const user = [...byCluster.entries()]
      .map(([idx, titles]) => `Cluster ${idx} (${size[idx]} stories):\n${titles.map((t) => `  - ${t}`).join('\n')}`)
      .join('\n');
    const res = await chatJSON<{ clusters?: unknown }>(system, user);
    labels = sanitizeClusterLabels(res.clusters, k);
  } catch (e) {
    console.error('[science] cluster labeling failed, using fallback labels:', e);
  }

  // replace-all write, then remap stories
  db.delete(topicClusters).run();
  const idByIndex = new Map<number, number>();
  for (let c = 0; c < k; c++) {
    if (size[c] === 0) continue;
    const row = db
      .insert(topicClusters)
      .values({
        label: labels.get(c)?.label ?? `Topic ${c + 1}`,
        summary: labels.get(c)?.summary ?? null,
        size: size[c],
        heat: heat[c] / maxHeat,
        centroid: vecToBuffer(centroids[c]),
        date: utcDay(),
        createdAt: new Date(),
      })
      .returning()
      .get();
    idByIndex.set(c, row.id);
  }
  rows.forEach((r, i) => {
    db.update(stories)
      .set({
        clusterId: idByIndex.get(assignments[i]) ?? null,
        mapX: coords[i].x,
        mapY: coords[i].y,
      })
      .where(eq(stories.id, r.id))
      .run();
  });

  return { clusters: idByIndex.size, mapped: rows.length };
}

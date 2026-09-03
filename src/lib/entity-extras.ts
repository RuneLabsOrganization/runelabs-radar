import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { boardEntries, stories } from './db/schema';
import { canonicalEntityKey, canonicalEntityName, entitySlug, ENTITY_WINDOW_DAYS } from './entity';

/** Value + range-labeled change, the Stake/Yahoo delta-chip data. */
export interface Delta {
  current: number;
  previous: number;
  abs: number;
  /** null when previous is 0 (no meaningful %) */
  pct: number | null;
}

export function makeDelta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    abs: current - previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

/** Delta plus the actual day span between the two compared points (usually 7, less on young series). */
export interface MetricDelta extends Delta {
  days: number;
}

/** Mentions this week vs last week from a daily series (second half vs first half). */
export function weeklyDelta(series: number[]): Delta {
  const half = Math.floor(series.length / 2);
  const first = series.slice(0, half).reduce((a, v) => a + v, 0);
  const second = series.slice(half).reduce((a, v) => a + v, 0);
  return makeDelta(second, first);
}

/** Latest value vs the value ~7 days earlier, from a dated metric series. */
export function metricWeeklyDelta(points: { date: string; value: number }[]): MetricDelta | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const target = new Date(new Date(`${latest.date}T00:00:00Z`).getTime() - 7 * 864e5)
    .toISOString()
    .slice(0, 10);
  // closest point at or before the target; fall back to the oldest
  let prev = sorted[0];
  for (const p of sorted) {
    if (p.date <= target) prev = p;
    else break;
  }
  const days = Math.round(
    (new Date(`${latest.date}T00:00:00Z`).getTime() - new Date(`${prev.date}T00:00:00Z`).getTime()) / 864e5,
  );
  return { ...makeDelta(latest.value, prev.value), days };
}

export interface BoardPlacement {
  domain: string;
  task: string;
  role: 'best overall' | 'best value' | 'cheapest viable';
}

/**
 * Where an entity sits on the Best-Right-Now board — the "what is it best FOR?"
 * answer. Case-insensitive containment against the board's text fields.
 */
export function boardPlacements(name: string): BoardPlacement[] {
  const db = getDb();
  const needle = `%${name.toLowerCase()}%`;
  const rows = db
    .select({
      domain: boardEntries.domain,
      task: boardEntries.task,
      bestOverall: boardEntries.bestOverall,
      bestValue: boardEntries.bestValue,
      cheapestViable: boardEntries.cheapestViable,
    })
    .from(boardEntries)
    .where(
      sql`lower(coalesce(${boardEntries.bestOverall}, '')) LIKE ${needle}
          OR lower(coalesce(${boardEntries.bestValue}, '')) LIKE ${needle}
          OR lower(coalesce(${boardEntries.cheapestViable}, '')) LIKE ${needle}`,
    )
    .all();
  const out: BoardPlacement[] = [];
  for (const r of rows) {
    const n = name.toLowerCase();
    if (r.bestOverall?.toLowerCase().includes(n)) out.push({ domain: r.domain, task: r.task, role: 'best overall' });
    if (r.bestValue?.toLowerCase().includes(n)) out.push({ domain: r.domain, task: r.task, role: 'best value' });
    if (r.cheapestViable?.toLowerCase().includes(n)) out.push({ domain: r.domain, task: r.task, role: 'cheapest viable' });
  }
  return out;
}

export interface CoMentioned {
  name: string;
  slug: string;
  count: number;
}

/**
 * Entities that appear in the same stories as this one (canonical-key merged,
 * so "GPT-5" and "gpt 5" count once), over the last 90d — the same bound as
 * resolveEntity. The discovery graph behind watch pages.
 */
export function coMentioned(name: string, limit = 6): CoMentioned[] {
  const db = getDb();
  const key = canonicalEntityKey(name);
  // created_at is unix seconds (drizzle timestamp mode)
  const windowStart = Math.floor((Date.now() - ENTITY_WINDOW_DAYS * 864e5) / 1000);
  const rows = db.all<{ name: string; count: number }>(
    sql`SELECT e.value->>'name' AS name, count(DISTINCT s.id) AS count
        FROM stories s, json_each(s.entities) e
        WHERE s.status = 'curated'
          AND s.created_at >= ${windowStart}
          AND EXISTS (
            SELECT 1 FROM json_each(s.entities) self
            WHERE replace(replace(replace(replace(replace(lower(self.value->>'name'),' ',''),'-',''),'.',''),'_',''),'/','') = ${key}
          )
        GROUP BY lower(e.value->>'name')
        ORDER BY count DESC`,
  );
  const merged = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const k = canonicalEntityKey(row.name);
    if (k === key || k === '') continue; // skip self
    const cur = merged.get(k);
    if (cur) cur.count += row.count;
    else merged.set(k, { name: canonicalEntityName(row.name), count: row.count });
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((m) => ({ name: m.name, slug: entitySlug(m.name), count: m.count }));
}

/** Display names for the metric_points sources; unknown sources fall back to the raw id. */
const SOURCE_LABELS: Record<string, string> = {
  aa: 'Artificial Analysis',
  github: 'GitHub',
  huggingface: 'Hugging Face',
  npm: 'npm',
  launches: 'launches',
};

/** "github:owner/repo:stars" → "GitHub stars · owner/repo". */
export function humanizeMetricKey(key: string): string {
  const [source, entity, metric] = key.split(':');
  const metricLabel =
    metric === 'weekly_downloads' ? 'weekly downloads' : metric === 'downloads' ? 'downloads' : metric ?? '';
  const sourceLabel = SOURCE_LABELS[source] ?? (source.startsWith('aa-media-') ? 'Artificial Analysis' : source);
  return `${sourceLabel} ${metricLabel} · ${entity}`;
}

/**
 * Top entities inside one sector over the last 7 days (same window as
 * topEntities()): entities from curated stories whose score for the domain
 * clears the membership threshold (>= 40), canonical-merged, ranked by
 * distinct story count.
 */
export function topEntitiesInDomain(domain: string, limit = 6): CoMentioned[] {
  const db = getDb();
  // created_at is unix seconds (drizzle timestamp mode)
  const weekAgo = Math.floor((Date.now() - 7 * 864e5) / 1000);
  const rows = db.all<{ name: string; count: number }>(
    sql`SELECT e.value->>'name' AS name, count(DISTINCT s.id) AS count
        FROM stories s, json_each(s.entities) e
        WHERE s.status = 'curated'
          AND CAST(coalesce(json_extract(s.domain_scores, '$.' || ${domain}), 0) AS INTEGER) >= 40
          AND s.created_at >= ${weekAgo}
        GROUP BY lower(e.value->>'name')
        ORDER BY count DESC`,
  );
  const merged = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const k = canonicalEntityKey(row.name);
    if (k === '') continue;
    const cur = merged.get(k);
    if (cur) cur.count += row.count;
    else merged.set(k, { name: canonicalEntityName(row.name), count: row.count });
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((m) => ({ name: m.name, slug: entitySlug(m.name), count: m.count }));
}

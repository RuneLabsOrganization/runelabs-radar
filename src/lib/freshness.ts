import { and, asc, eq, gte } from 'drizzle-orm';
import { getDb } from './db';
import { boardHistory, stories } from './db/schema';
import { median } from './stats';

/**
 * Freshness — how fast the radar reflects what's happening (the trust-page
 * metric; Phase 10). Two honestly-measurable lags, both over curated stories
 * created in the trailing window (default 90 days):
 *
 * 1. BOARD REFLECTION (hours): a board_history row "reflects" a story when
 *    its change text contains one of the story's curated entity names,
 *    case-insensitive substring (change text is `bestOverall: X -> Y; …` —
 *    entity names appear verbatim). Entity names shorter than 3 chars are
 *    ignored (same bar as hindsight.ts's launch materialization): a 2-char
 *    name like "o3" matches incidental substrings and fabricates reflections
 *    with tiny lags. Each board_history row is claimed by at most ONE story
 *    (earliest-created first) — one giant sync row naming a dozen entities
 *    would otherwise contribute a dozen same-lag pairs and drag the median
 *    down. Lag = appliedAt − createdAt for the story's FIRST matching
 *    unclaimed row at/after the story appeared; rows before createdAt can't
 *    reflect the story and would only fabricate negative lags. Caveat: name
 *    matching is a heuristic — a change can mention an entity for reasons
 *    unrelated to the story, and a real reflection that names no entity is
 *    missed. That's why the per-pair detail is returned for spot checks
 *    instead of only the aggregate.
 *
 * 2. MERGE LAG (minutes): stories.updatedAt is stamped when a new item
 *    merges into an existing story. Median createdAt → updatedAt over
 *    stories that have merged at least once. updatedAt is the LATEST merge
 *    (the schema keeps no first-merge timestamp), so this overstates
 *    time-to-first-merge — it's an upper bound, published as such.
 *
 * Both medians are null when there's nothing to measure; the page renders a
 * "collecting" note rather than a fake zero.
 */

export interface BoardReflection {
  storyId: number;
  storyTitle: string;
  /** the entity name (lowercased) that matched the change text */
  entity: string;
  /** the board change text that reflected the story */
  change: string;
  appliedAt: Date;
  lagHours: number;
}

export interface FreshnessStats {
  windowDays: number;
  boardReflection: {
    medianHours: number | null;
    /** stories with at least one matching board row */
    matched: number;
    /** curated stories in the window with at least one usable entity name */
    considered: number;
    /** one row per matched story (first match only), most recent first */
    pairs: BoardReflection[];
  };
  mergeLag: {
    medianMinutes: number | null;
    count: number;
  };
}

/** Entity names from the curation JSON ([{name, kind}]) — lowercased, ≥3 chars (a 2-char name substring-matches everything); [] on any malformation. */
function entityNames(entitiesJson: string | null): string[] {
  if (!entitiesJson) return [];
  try {
    const parsed: unknown = JSON.parse(entitiesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((e) => (typeof (e as { name?: unknown })?.name === 'string' ? (e as { name: string }).name : ''))
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length >= 3);
  } catch {
    return [];
  }
}

export function freshnessStats(now = new Date(), windowDays = 90): FreshnessStats {
  const db = getDb();
  const since = new Date(now.getTime() - windowDays * 864e5);

  const storyRows = db
    .select({
      id: stories.id,
      title: stories.title,
      entities: stories.entities,
      createdAt: stories.createdAt,
      updatedAt: stories.updatedAt,
    })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, since)))
    .all();

  const mergeLags = storyRows
    .filter((s) => s.updatedAt !== null && s.updatedAt >= s.createdAt)
    .map((s) => (s.updatedAt!.getTime() - s.createdAt.getTime()) / 60_000);
  const mergeMedian = median(mergeLags);

  // Only changes at/after a story's createdAt can reflect it, and every
  // candidate story sits inside [since, now] — so rows older than the window
  // can never match. Bounding the read keeps the trust page from loading the
  // entire board_history table (and lowercasing every row) forever.
  const changes = db
    .select({ change: boardHistory.change, appliedAt: boardHistory.appliedAt })
    .from(boardHistory)
    .where(gte(boardHistory.appliedAt, since))
    .orderBy(asc(boardHistory.appliedAt))
    .all()
    .map((c) => ({ ...c, lower: c.change.toLowerCase() }));

  const pairs: BoardReflection[] = [];
  let considered = 0;
  // earliest-created story claims a contested row first: the closest thing to
  // a fair assignment when one change names several stories' entities
  const claimed = new Set<(typeof changes)[number]>();
  const byAge = [...storyRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const s of byAge) {
    const names = entityNames(s.entities);
    if (names.length === 0) continue;
    considered++;
    const hit = changes.find(
      (c) => !claimed.has(c) && c.appliedAt >= s.createdAt && names.some((n) => c.lower.includes(n)),
    );
    if (!hit) continue;
    claimed.add(hit);
    pairs.push({
      storyId: s.id,
      storyTitle: s.title,
      entity: names.find((n) => hit.lower.includes(n))!,
      change: hit.change,
      appliedAt: hit.appliedAt,
      lagHours: Math.round(((hit.appliedAt.getTime() - s.createdAt.getTime()) / 3_600_000) * 10) / 10,
    });
  }
  pairs.sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime());
  const boardMedian = median(pairs.map((p) => p.lagHours));

  return {
    windowDays,
    boardReflection: {
      medianHours: boardMedian === null ? null : Math.round(boardMedian * 10) / 10,
      matched: pairs.length,
      considered,
      pairs,
    },
    mergeLag: {
      medianMinutes: mergeMedian === null ? null : Math.round(mergeMedian),
      count: mergeLags.length,
    },
  };
}

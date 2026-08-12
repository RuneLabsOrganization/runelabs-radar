import type { stories } from './db/schema';

export type Story = typeof stories.$inferSelect;

/**
 * The slice of a story the feed renders — safe to serialize to client
 * components (the full row carries the embedding Buffer, which is not).
 */
export type FeedStory = Pick<
  Story,
  'id' | 'title' | 'tldr' | 'whyItMatters' | 'whyShown' | 'domainScores' | 'topScore' | 'createdAt'
>;

/** Score at or above which a contact leads the briefing as a top signal. */
export const TOP_SIGNAL_MIN = 70;
/** Score below which a contact is archive noise, not worth the scan log. */
export const SCAN_MIN = 40;
/** The briefing stays readable in one sitting — cap the top section. */
export const TOP_MAX = 8;

/** 1–4 phosphor bars for a 0–100 relevance score. */
export function signalLevel(score: number): 1 | 2 | 3 | 4 {
  if (score >= 80) return 4;
  if (score >= 60) return 3;
  if (score >= SCAN_MIN) return 2;
  return 1;
}

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface Scored {
  score: number;
  createdAt: Date;
}

export interface FeedSplit<T> {
  /** Highest-relevance contacts, score order, capped at TOP_MAX. */
  top: T[];
  /** Everything else worth seeing, newest first (a log, not a ranking). */
  scan: T[];
  /** Contacts below SCAN_MIN — surfaced only as an archive count. */
  lowCount: number;
}

/** Splits a curated list into the briefing structure: top signals / scan log / archive. */
export function splitFeed<T extends Scored>(list: T[]): FeedSplit<T> {
  const byScore = [...list].sort((a, b) => b.score - a.score);
  const top = byScore.filter((e) => e.score >= TOP_SIGNAL_MIN).slice(0, TOP_MAX);
  const topSet = new Set(top);
  const scan = byScore
    .filter((e) => !topSet.has(e) && e.score >= SCAN_MIN)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const lowCount = byScore.filter((e) => e.score < SCAN_MIN).length;
  return { top, scan, lowCount };
}

/**
 * Personalized re-ranking (heuristic v1): a per-domain taste vector derived
 * from the user's own votes.
 *
 * affinity_d = (mean domain score of upvoted stories) − (mean of downvoted),
 * expressed in [-1, 1]. Upvoting high-coding stories raises `coding`; a domain
 * the user only ever downvotes sinks below zero.
 */
export function domainAffinity(
  rows: { value: number; domainScores: string | null }[],
): Partial<Record<string, number>> {
  const up = new Map<string, { sum: number; n: number }>();
  const down = new Map<string, { sum: number; n: number }>();
  for (const row of rows) {
    let scores: Record<string, number> = {};
    try {
      scores = JSON.parse(row.domainScores ?? '{}') as Record<string, number>;
    } catch {
      continue;
    }
    const acc = row.value === 1 ? up : row.value === -1 ? down : null;
    if (!acc) continue;
    for (const [d, v] of Object.entries(scores)) {
      if (typeof v !== 'number' || v <= 0) continue;
      const e = acc.get(d) ?? { sum: 0, n: 0 };
      e.sum += v;
      e.n += 1;
      acc.set(d, e);
    }
  }
  const out: Partial<Record<string, number>> = {};
  for (const d of new Set([...up.keys(), ...down.keys()])) {
    const u = up.get(d);
    const dn = down.get(d);
    const meanUp = u ? u.sum / u.n : 0;
    const meanDown = dn ? dn.sum / dn.n : 0;
    out[d] = Math.max(-1, Math.min(1, (meanUp - meanDown) / 100));
  }
  return out;
}

/** Cap on the absolute personalization shift, in score points. */
export const AFFINITY_MAX_BOOST = 12;
/**
 * Applies the taste vector to a story's top score. The boost uses the
 * single best-matching domain (max, not sum) so broad stories don't stack
 * boosts; result stays within ±AFFINITY_MAX_BOOST and [0, 100].
 */
export function personalScore(
  topScore: number,
  domainScores: string | null,
  affinity: Partial<Record<string, number>>,
): number {
  let scores: Record<string, number> = {};
  try {
    scores = JSON.parse(domainScores ?? '{}') as Record<string, number>;
  } catch {
    return topScore;
  }
  let best = 0;
  for (const [d, v] of Object.entries(scores)) {
    const a = affinity[d] ?? 0;
    if (a === 0 || typeof v !== 'number') continue;
    const contribution = a * (v / 100);
    if (Math.abs(contribution) > Math.abs(best)) best = contribution;
  }
  const boost = Math.round(best * AFFINITY_MAX_BOOST);
  return Math.max(0, Math.min(100, topScore + boost));
}

export interface DomainGroup<T> {
  /** primary domain of every item in the group; null = unscored/uncategorized */
  domain: string | null;
  items: T[];
}

/**
 * Chunks the scan log by each contact's primary domain so a long list gets
 * labeled anchor points. Groups are ordered by their highest-scoring item
 * (strongest sector first); items keep their input (newest-first) order.
 * Domain-less contacts collect in one trailing null group.
 */
export function groupByDomain<T>(
  list: T[],
  domainOf: (item: T) => string | null,
  scoreOf: (item: T) => number,
): DomainGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const item of list) {
    const d = domainOf(item);
    const g = groups.get(d) ?? [];
    g.push(item);
    groups.set(d, g);
  }
  return [...groups.entries()]
    .map(([domain, items]) => ({ domain, items }))
    .sort((a, b) => {
      if (a.domain === null) return 1; // uncategorized always last
      if (b.domain === null) return -1;
      return Math.max(...b.items.map(scoreOf)) - Math.max(...a.items.map(scoreOf));
    });
}

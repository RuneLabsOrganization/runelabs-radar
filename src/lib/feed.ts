import type { stories } from './db/schema';
import { SCAN_MIN, TOP_SIGNAL_MIN } from './bands';

// Canonical cutoffs live in ./bands (the threshold atlas) — re-exported here
// so existing '@/lib/feed' importers keep working.
export { SCAN_MIN, TOP_SIGNAL_MIN, signalLevel, rubricBand } from './bands';

export type Story = typeof stories.$inferSelect;

/**
 * The slice of a story the feed renders — safe to serialize to client
 * components (the full row carries the embedding Buffer, which is not).
 */
export type FeedStory = Pick<
  Story,
  'id' | 'title' | 'tldr' | 'whyItMatters' | 'whyShown' | 'domainScores' | 'topScore' | 'createdAt' | 'updatedAt'
>;

/** The briefing stays readable in one sitting — cap the top section. */
export const TOP_MAX = 8;

/**
 * Compact relative time: "just now", "5m ago", "3h ago", "2d ago", "3w ago",
 * "5mo ago", "2y ago". Weeks/months/years are coarse floored regimes (7d /
 * 30d / 365d) — a bound, not a calendar calculation, so "400d ago" never
 * renders.
 */
export function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * "SUN 02 FEB 2025" from UTC getters — every data bucket in the product is a
 * UTC day, so the one header that names "today" must use the same clock or it
 * disagrees with the buckets near midnight local time.
 */
export function utcDateLine(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface SplitDays<T> {
  /** Buckets whose UTC day has fully elapsed — safe to compare and accent. */
  complete: T[];
  /**
   * The trailing bucket when its date IS today's UTC date: still filling up,
   * so it reads as a crash next to complete days. Render it visually
   * distinct (hatched/attenuated), never as a full bar — the anomaly
   * detectors exclude today for the same reason.
   */
  partial: T | null;
}

/**
 * Splits a zero-filled daily series (oldest first) into complete days and a
 * trailing partial-today bucket. `today` is injectable for tests; the default
 * stamps the UTC day inline (same formula as metrics.utcDay) because feed.ts
 * must stay client-safe — metrics.ts pulls in the DB layer.
 */
export function splitCompleteDays<T extends { date: string }>(days: T[], today?: string): SplitDays<T> {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const last = days[days.length - 1];
  if (last && last.date === todayStr) {
    return { complete: days.slice(0, -1), partial: last };
  }
  return { complete: days, partial: null };
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
 *
 * SHRINKAGE: the raw difference is scaled by n/(n+PRIOR_VOTES) where n is the
 * number of votes that touched the domain. Without it a single downvote on an
 * 80-scoring story lands affinity at −0.8 — near-max penalty from n=1. The
 * prior of 3 means one vote moves affinity at quarter strength; by ~27 votes
 * the estimate is 90% of the raw difference (converges to it as n → ∞).
 */
export const AFFINITY_PRIOR_VOTES = 3;

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
    const n = (u?.n ?? 0) + (dn?.n ?? 0);
    const meanUp = u ? u.sum / u.n : 0;
    const meanDown = dn ? dn.sum / dn.n : 0;
    const raw = (meanUp - meanDown) / 100;
    out[d] = Math.max(-1, Math.min(1, (raw * n) / (n + AFFINITY_PRIOR_VOTES)));
  }
  return out;
}

/** Cap on the absolute personalization shift, in score points. */
export const AFFINITY_MAX_BOOST = 12;
/**
 * Applies the taste vector to a story's top score. The boost uses a single
 * domain (max, not sum) so broad stories don't stack boosts; result stays
 * within ±AFFINITY_MAX_BOOST and [0, 100].
 *
 * The domain is chosen by the STORY's own scores, strongest first — the
 * domain that defines the story gets the first say. The old maxByAbs rule
 * let a large dislike in a secondary domain override a like in the story's
 * primary domain (coding-90/liked losing to video-60/disliked).
 *
 * Pass `domain` to restrict the boost to that one sector's affinity — sector
 * pages re-rank by their own score, so an unrelated domain's taste must not
 * contribute.
 */
export function personalScore(
  topScore: number,
  domainScores: string | null,
  affinity: Partial<Record<string, number>>,
  domain?: string,
): number {
  let scores: Record<string, number> = {};
  try {
    scores = JSON.parse(domainScores ?? '{}') as Record<string, number>;
  } catch {
    return topScore;
  }
  let best = 0;
  const entries = Object.entries(scores)
    .filter(([d, v]) => (domain === undefined || d === domain) && typeof v === 'number')
    .sort((a, b) => b[1] - a[1]); // the story's own top domain first
  for (const [d, v] of entries) {
    const a = affinity[d] ?? 0;
    if (a === 0) continue;
    best = a * (v / 100);
    break;
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

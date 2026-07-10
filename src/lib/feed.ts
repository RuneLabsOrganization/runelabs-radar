import type { stories } from './db/schema';

export type Story = typeof stories.$inferSelect;

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

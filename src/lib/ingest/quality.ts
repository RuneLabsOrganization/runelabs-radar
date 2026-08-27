/**
 * Is a source worth its slot? Liveness (health.ts) says the feed responds;
 * this says the feed is worth reading. Deliberately conservative: a small
 * window is 'watch', never 'drop' — we do not kill a source on thin evidence.
 */

export interface SourceWindowStats {
  /** Items ingested from this source in the window. */
  fetched: number;
  /** Items that were merged into any story. */
  used: number;
  /** Items whose story reached status 'curated'. */
  curated: number;
  /** Mean top_score of this source's curated stories, null when none. */
  meanTopScore: number | null;
  /** Mean hindsight of this source's graded stories, null when none graded yet. */
  meanHindsight: number | null;
}

export type SourceVerdict = 'keep' | 'watch' | 'demote' | 'drop';

/** Below this many fetched items the window cannot support a judgement. */
export const MIN_SAMPLE = 20;
/** Used-item fraction under which a source is noise at volume. */
export const LOW_YIELD = 0.02;
/** Mean hindsight under which curated items are landing and going nowhere. */
export const WEAK_HINDSIGHT = 10;

export function sourceVerdict(s: SourceWindowStats): { verdict: SourceVerdict; reason: string } {
  if (s.fetched < MIN_SAMPLE) {
    return { verdict: 'watch', reason: `only ${s.fetched} items in window — too few to judge` };
  }
  if (s.curated === 0) {
    return { verdict: 'drop', reason: `${s.fetched} items, none reached a curated story` };
  }
  const yieldPct = s.used / s.fetched;
  if (yieldPct < LOW_YIELD) {
    return {
      verdict: 'demote',
      reason: `${Math.round(yieldPct * 1000) / 10}% of items used — high volume, low signal`,
    };
  }
  if (s.meanHindsight !== null && s.meanHindsight < WEAK_HINDSIGHT) {
    return {
      verdict: 'watch',
      reason: `curated but mean hindsight ${Math.round(s.meanHindsight)} — items land and go nowhere`,
    };
  }
  return { verdict: 'keep', reason: `${s.used}/${s.fetched} items used` };
}

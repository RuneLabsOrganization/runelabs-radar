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
  /**
   * Items still awaiting the pipeline's verdict: inside the 72h curation
   * window or attached to a 'raw' story. A high count means curator backlog,
   * not source quality.
   */
  pending: number;
  /** Distinct graded stories (hindsight != null) behind meanHindsight. */
  graded: number;
  /**
   * Days since this source's oldest item in the window was fetched — a proxy
   * for how long the pipeline has had to judge it (the sources table keeps no
   * createdAt). Null when the source has no items at all.
   */
  sourceAgeDays: number | null;
  /** Mean top_score of this source's curated stories, null when none. */
  meanTopScore: number | null;
  /** Mean hindsight of this source's graded stories, null when none graded yet. */
  meanHindsight: number | null;
  /**
   * Sample size the verdict requires — the caller scales it to the source's
   * poll cadence (a weekly newsletter can't hit 20 items in 30d). Defaults to
   * MIN_SAMPLE.
   */
  minSample?: number;
}

export type SourceVerdict = 'keep' | 'watch' | 'demote' | 'drop';

/** Below this many fetched items the window cannot support a judgement. */
export const MIN_SAMPLE = 20;
/** Used-item fraction under which a source is noise at volume. */
export const LOW_YIELD = 0.02;
/** Mean hindsight under which curated items are landing and going nowhere. */
export const WEAK_HINDSIGHT = 10;
/**
 * A zero-curation source is only droppable once the pipeline has had this many
 * days to judge its items — a fresh high-value source is backlog, not noise.
 */
export const MIN_SOURCE_AGE_DAYS = 7;
/** Below this many graded stories, hindsight is noise — report, don't judge. */
export const MIN_GRADED = 3;

export function sourceVerdict(s: SourceWindowStats): { verdict: SourceVerdict; reason: string } {
  const minSample = s.minSample ?? MIN_SAMPLE;
  if (s.fetched < minSample) {
    return { verdict: 'watch', reason: `only ${s.fetched} items in window — too few to judge` };
  }
  if (s.curated === 0) {
    // drop only when the pipeline had a fair chance: the source has been
    // delivering for a while AND most of its items are past the curation
    // window. Otherwise zero curation is curator lag, not source quality.
    const fairChance =
      s.sourceAgeDays !== null &&
      s.sourceAgeDays >= MIN_SOURCE_AGE_DAYS &&
      s.pending <= Math.floor(s.fetched / 2);
    if (!fairChance) {
      return {
        verdict: 'watch',
        reason: `no curated stories yet, but pipeline hasn't had a fair chance (${s.pending} items still pending)`,
      };
    }
    return { verdict: 'drop', reason: `${s.fetched} items, none reached a curated story` };
  }
  const yieldPct = s.used / s.fetched;
  if (yieldPct < LOW_YIELD) {
    return {
      verdict: 'demote',
      reason: `${Math.round(yieldPct * 1000) / 10}% of items used — high volume, low signal`,
    };
  }
  if (s.graded < MIN_GRADED) {
    // too-new-to-grade stories used to skip the hindsight check entirely and
    // collect a free 'keep' — report insufficient data instead
    return {
      verdict: 'watch',
      reason: `only ${s.graded} graded stories — insufficient hindsight data`,
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

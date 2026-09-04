/**
 * The threshold atlas — one home for every 0–100 score cutoff, with the
 * mapping between the scales written down so "strong" stops meaning different
 * things on adjacent surfaces.
 *
 * THE FIVE SCALES
 *
 * 1. LLM rubric (src/lib/curate/curate.ts — the prompt's own words):
 *    0–19 irrelevant · 20–39 tangential · 40–59 relevant · 60–79 important ·
 *    80–100 critical. This is the semantic anchor: every other scale is a
 *    presentation choice layered on top of it. `rubricBand` below reproduces
 *    those cutoffs; the prompt is the source of truth, keep them in sync.
 *
 * 2. Feed curation bands (this module): SCAN_MIN 40 / TOP_SIGNAL_MIN 70.
 *    40 is the rubric's "relevant" line — below it a contact is archive noise.
 *    70 sits deliberately INSIDE the rubric's "important" band (60–79): the
 *    briefing's top section means "worth acting on this week", not the
 *    rubric's once-a-quarter "critical — act now" (80). A 70–79 story is
 *    therefore coherent everywhere: rubric "important", 3 signal bars, and a
 *    top-signal slot.
 *
 * 3. Signal meter (SignalMeter): 1–4 phosphor bars at 40/60/80 — the rubric's
 *    relevant/important/critical lines, so the glyph literally spells the
 *    rubric. `signalLevel` lives here so the meter and the feed can never
 *    drift apart.
 *
 * 4. Opportunity grade bands (src/lib/opportunities/axes.ts — OWNED BY THE
 *    OPPORTUNITIES STREAM, do not re-cut here): gradeColor/gradeBand use
 *    70 strong / 45 fair on a 0–100 weighted composite of ten 0–20 axes. That
 *    70 is NOT the feed's 70: the composite is a different quantity (a
 *    weighted launch assessment, not an LLM relevance score), and its
 *    distribution is compressed by the weighting, so its "strong" line sits
 *    at the same numeral by coincidence of convention, not by shared meaning.
 *    Mapping for whoever aligns them: grade 70 ≈ "pursue", feed 70 ≈ rubric
 *    "important"; never feed one scale's number into the other's cutoffs.
 *
 * 5. Domain membership (src/lib/domains.ts DOMAIN_MEMBERSHIP_THRESHOLD = 40):
 *    the same "relevant" line as SCAN_MIN — a story belongs to a sector when
 *    the rubric would call it relevant there.
 */

/** Rubric band for a 0–100 relevance score, cutoffs per the curation prompt. */
export function rubricBand(score: number): 'critical' | 'important' | 'relevant' | 'tangential' | 'irrelevant' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'important';
  if (score >= 40) return 'relevant';
  if (score >= 20) return 'tangential';
  return 'irrelevant';
}

/** Score at or above which a contact leads the briefing as a top signal. */
export const TOP_SIGNAL_MIN = 70;
/** Score below which a contact is archive noise, not worth the scan log. */
export const SCAN_MIN = 40;

/**
 * 1–4 phosphor bars for a 0–100 relevance score — cutoffs are the rubric's
 * relevant/important/critical lines (scale 3 above).
 */
export function signalLevel(score: number): 1 | 2 | 3 | 4 {
  if (score >= 80) return 4;
  if (score >= 60) return 3;
  if (score >= SCAN_MIN) return 2;
  return 1;
}

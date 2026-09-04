/**
 * Backfills kit_picks pricing from the metric series written by the pricing
 * feeders, and recomputes confidence from kit_evidence.
 *
 * The unit decides the price model, and that decision is load-bearing:
 * a per-month price is a seat price and can be totalled; a per-image or
 * per-second price is unbounded monthly spend and becomes priceModel 'usage'
 * with a risk flag, which composeKit() excludes from the total by design.
 * Turning a per-second rate into a fake monthly figure would be exactly the
 * bill-shock this product exists to warn about.
 */
import { and, desc, gte, inArray } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { kitEvidence, kitPicks, metricPoints } from '../db/schema';
import { MEDIA_PRICING_SOURCE } from '../ingest/media-pricing';
import { PRICING_SOURCE } from '../ingest/pricing';
import { gradeConfidence } from './confidence';
import { matchPricedEntity } from './match-price';
import { independence } from './provenance';

/**
 * Only points inside this window count as "latest". metric_points is
 * append-forever and the feeders run weekly, so scanning all of history every
 * daily run read thousands of dead rows for the same handful of prices; 90
 * days covers ~12 repricings of every entity.
 */
const PRICE_WINDOW_DAYS = 90;

const UNIT_RISK: Record<string, string> = {
  price_per_second: 'billed per second of output — cost scales with how much you generate',
  price_per_image: 'billed per image — cost scales with volume',
  price_per_1k_chars: 'billed per 1k characters — cost scales with volume',
  // provider-pricing (per-token LLM list prices). A model's monthly cost is a
  // function of how much you send it, so this can never be a seat price.
  price_in: 'billed per token — cost scales with how much you use it',
  price_out: 'billed per token — cost scales with how much you use it',
  price_cache_hit: 'billed per token — cost scales with how much you use it',
};

/**
 * Latest value per (entity, metric) across both pricing feeders.
 *
 * media-pricing carries per-unit prices for image/video/audio tools;
 * provider-pricing carries per-token LLM list prices. Most board picks are
 * LLMs, so reading only the former left almost every pick unpriced.
 *
 * Keyed per metric, not per entity: an entity with both a monthly plan and a
 * per-unit price keeps BOTH, so the seat-vs-usage decision below is a
 * documented precedence instead of whichever row happened to be newest (the
 * feeders run on independent schedules, so "newest overall" flipped a pick
 * between seat and usage run-to-run).
 */
function latestPrices(): Map<string, Map<string, number>> {
  // metric_points keys on `date` (YYYY-MM-DD text), not a timestamp — see
  // schema.ts. ISO dates compare chronologically as text, so the window
  // bound is a plain string comparison.
  const cutoff = new Date(Date.now() - PRICE_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const rows = getDb()
    .select()
    .from(metricPoints)
    .where(and(gte(metricPoints.date, cutoff), inArray(metricPoints.source, [MEDIA_PRICING_SOURCE, PRICING_SOURCE])))
    .orderBy(desc(metricPoints.date), desc(metricPoints.id))
    .all();
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let byMetric = out.get(r.entity);
    if (!byMetric) {
      byMetric = new Map();
      out.set(r.entity, byMetric);
    }
    // rows arrive newest-first, so the first sighting of a metric is its latest value
    if (!byMetric.has(r.metric)) byMetric.set(r.metric, r.value);
  }
  return out;
}

/**
 * Seat-vs-usage precedence when an entity has several in-window metrics:
 * price_per_month wins — a published monthly plan is the only total-able
 * price model. Everything else is usage-priced; the newest metric (insertion
 * order is newest-first) supplies the risk-flag wording, and no monthly
 * amount is asserted, because turning a per-unit rate into a monthly figure
 * would be exactly the bill-shock this product exists to warn about.
 */
function pickPriceModel(byMetric: Map<string, number>): { metric: string; value: number } | null {
  const seat = byMetric.get('price_per_month');
  if (seat !== undefined) return { metric: 'price_per_month', value: seat };
  const first = byMetric.entries().next();
  return first.done ? null : { metric: first.value[0], value: first.value[1] };
}

export function runKitPriceBackfill(now: Date = new Date()): { updated: number } {
  const db = getDb();
  const prices = latestPrices();
  let updated = 0;

  for (const pick of db.select().from(kitPicks).all()) {
    // Exact match after stripping effort/runtime qualifiers — a near-miss like
    // "GPT-5.6 Sol (max)" -> "GPT-5.5" would assert someone else's price.
    const entity = matchPricedEntity(pick.pickName, prices.keys());
    const byMetric = entity ? prices.get(entity) : undefined;
    const found = byMetric ? pickPriceModel(byMetric) : null;
    if (!found) continue;

    const isSeat = found.metric === 'price_per_month';
    const nextModel = isSeat ? 'seat' : 'usage';
    const nextAmount = isSeat ? found.value : null;
    const nextRisk = isSeat ? null : (UNIT_RISK[found.metric] ?? 'usage-priced');

    if (pick.priceModel === nextModel && pick.priceUsdMonth === nextAmount && pick.riskFlag === nextRisk) {
      continue; // already correct — keeps the job idempotent
    }

    db.update(kitPicks)
      .set({ priceModel: nextModel, priceUsdMonth: nextAmount, riskFlag: nextRisk, updatedAt: now })
      .where(eq(kitPicks.id, pick.id))
      .run();
    updated++;
  }
  return { updated };
}

/** Recomputes evidence_count, distinct_sources, verified_at and confidence for every pick. */
export function runKitGrade(now: Date = new Date()): { graded: number } {
  const db = getDb();
  let graded = 0;

  for (const pick of db.select().from(kitPicks).all()) {
    const ev = db.select().from(kitEvidence).where(eq(kitEvidence.pickId, pick.id)).all();
    if (ev.length === 0) continue;

    const evidenceCount = ev.length;
    // Independence is by registrable domain (provenance.ts), not raw hostname:
    // blog.vendor.com and vendor.com are ONE source, and evidence that is
    // entirely first-party/community cannot lift a verdict past 'low'.
    const { distinctDomains, independentDomains } = independence(
      ev.map((e) => ({ sourceUrl: e.sourceUrl, role: e.role })),
    );
    const distinctSources = distinctDomains;
    const verifiedAt = ev.reduce<Date>((max, e) => (e.observedAt > max ? e.observedAt : max), ev[0].observedAt);
    const confidence = gradeConfidence({ evidenceCount, distinctSources, verifiedAt, independentDomains, now });

    if (
      pick.evidenceCount === evidenceCount &&
      pick.distinctSources === distinctSources &&
      pick.verifiedAt?.getTime() === verifiedAt.getTime() &&
      pick.confidence === confidence
    ) {
      continue; // already correct — keeps the job idempotent
    }

    db.update(kitPicks)
      .set({ evidenceCount, distinctSources, verifiedAt, confidence, updatedAt: now })
      .where(eq(kitPicks.id, pick.id))
      .run();
    graded++;
  }
  return { graded };
}

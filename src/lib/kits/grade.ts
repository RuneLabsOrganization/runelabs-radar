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
import { desc, inArray } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { kitEvidence, kitPicks, metricPoints } from '../db/schema';
import { MEDIA_PRICING_SOURCE } from '../ingest/media-pricing';
import { PRICING_SOURCE } from '../ingest/pricing';
import { gradeConfidence } from './confidence';
import { matchPricedEntity } from './match-price';

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
 * Latest value per entity across both pricing feeders.
 *
 * media-pricing carries per-unit prices for image/video/audio tools;
 * provider-pricing carries per-token LLM list prices. Most board picks are
 * LLMs, so reading only the former left almost every pick unpriced.
 */
function latestPrices(): Map<string, { metric: string; value: number }> {
  // metric_points keys on `date` (YYYY-MM-DD text), not a timestamp — see schema.ts
  const rows = getDb()
    .select()
    .from(metricPoints)
    .where(inArray(metricPoints.source, [MEDIA_PRICING_SOURCE, PRICING_SOURCE]))
    .orderBy(desc(metricPoints.date), desc(metricPoints.id))
    .all();
  const out = new Map<string, { metric: string; value: number }>();
  for (const r of rows) {
    if (!out.has(r.entity)) out.set(r.entity, { metric: r.metric, value: r.value });
  }
  return out;
}

export function runKitPriceBackfill(now: Date = new Date()): { updated: number } {
  const db = getDb();
  const prices = latestPrices();
  let updated = 0;

  for (const pick of db.select().from(kitPicks).all()) {
    // Exact match after stripping effort/runtime qualifiers — a near-miss like
    // "GPT-5.6 Sol (max)" -> "GPT-5.5" would assert someone else's price.
    const entity = matchPricedEntity(pick.pickName, prices.keys());
    const found = entity ? prices.get(entity) : undefined;
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

function evidenceSourceKey(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl;
  }
}

/** Recomputes evidence_count, distinct_sources, verified_at and confidence for every pick. */
export function runKitGrade(now: Date = new Date()): { graded: number } {
  const db = getDb();
  let graded = 0;

  for (const pick of db.select().from(kitPicks).all()) {
    const ev = db.select().from(kitEvidence).where(eq(kitEvidence.pickId, pick.id)).all();
    if (ev.length === 0) continue;

    const evidenceCount = ev.length;
    const distinctSources = new Set(ev.map((e) => evidenceSourceKey(e.sourceUrl))).size;
    const verifiedAt = ev.reduce<Date>((max, e) => (e.observedAt > max ? e.observedAt : max), ev[0].observedAt);
    const confidence = gradeConfidence({ evidenceCount, distinctSources, verifiedAt, now });

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

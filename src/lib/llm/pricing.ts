/**
 * Static token prices in USD per 1M tokens, keyed by model name.
 * Source: MiniMax token-plan / pay-as-you-go docs
 * (https://platform.minimax.io/docs/guides/pricing-paygo). Update the map when
 * MiniMax reprices; unmapped models are unmetered, never silently $0.
 */
const PRICE_PER_1M_USD: Record<string, { in: number; out: number }> = {
  'MiniMax-M2': { in: 0.3, out: 1.2 },
  // M3 standard ≤512k, 50% off list: $0.30 in / $1.20 out
  'MiniMax-M3': { in: 0.3, out: 1.2 },
};

/**
 * Written to llm_calls.est_cost_usd when the model has no price entry. The
 * column is notNull (schema.ts) so "unknown" cannot be stored as null; a
 * negative is impossible as a real cost, so every aggregate can tell
 * "unmetered" apart from a legitimately cheap call. Usage aggregates
 * (src/lib/usage.ts) exclude the sentinel from sums and count the calls
 * separately. Rows written before this sentinel existed still carry 0 — only
 * new calls are distinguishable.
 */
export const UNMETERED_COST_USD = -1;

export function isMeteredModel(model: string): boolean {
  return model in PRICE_PER_1M_USD;
}

// Warn once per model per process: chatJSON retries and fan-out would
// otherwise log the same unknown model on every call.
const warnedModels = new Set<string>();

/**
 * Estimated USD cost of one call from its token usage; UNMETERED_COST_USD for
 * models with no price entry (with a once-per-model warning), so an unpriced
 * model surfaces in the unmetered counters instead of quietly summing as $0.
 */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICE_PER_1M_USD[model];
  if (!price) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      console.warn(`[llm] no price entry for model "${model}" — metering ${UNMETERED_COST_USD} (unmetered), add it to llm/pricing.ts`);
    }
    return UNMETERED_COST_USD;
  }
  return (promptTokens / 1e6) * price.in + (completionTokens / 1e6) * price.out;
}

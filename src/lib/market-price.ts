/**
 * Blended LLM price ($/1M tokens) — AA's 3:1 input:output convention, the one
 * every value/cost comparison in the product shares. Single-source so the
 * radar-score composite, the market table, and the prompt value sorts can
 * never drift apart.
 */

/** Weight on the input price in the 3:1 in:out blend (AA convention). */
export const AA_PRICE_BLEND_IN = 0.75;

export interface BlendedPrice {
  /** Blended $/1M, or null when neither side is priced. */
  price: number | null;
  /**
   * True when only one side was priced and it stood in for the whole blend —
   * output prices run ~3–4× input, so a single-sided estimate is biased and
   * any consumer comparing across models should disclose it.
   */
  singleSided: boolean;
}

export function blendedPrice(priceIn: number | null, priceOut: number | null): BlendedPrice {
  if (priceIn !== null && priceOut !== null) {
    return { price: AA_PRICE_BLEND_IN * priceIn + (1 - AA_PRICE_BLEND_IN) * priceOut, singleSided: false };
  }
  const side = priceIn ?? priceOut;
  if (side !== null) return { price: side, singleSided: true };
  return { price: null, singleSided: false };
}

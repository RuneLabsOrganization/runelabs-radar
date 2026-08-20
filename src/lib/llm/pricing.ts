/**
 * Static token prices in USD per 1M tokens, keyed by model name.
 * Source: MiniMax token-plan / pay-as-you-go docs
 * (https://platform.minimax.io/docs/guides/pricing-paygo). Update the map when
 * MiniMax reprices; unmapped models estimate as 0 rather than guess a number.
 */
const PRICE_PER_1M_USD: Record<string, { in: number; out: number }> = {
  'MiniMax-M2': { in: 0.3, out: 1.2 },
};

/** Estimated USD cost of one call from its token usage; 0 for unknown models. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICE_PER_1M_USD[model];
  if (!price) return 0;
  return (promptTokens / 1e6) * price.in + (completionTokens / 1e6) * price.out;
}

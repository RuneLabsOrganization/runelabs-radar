/**
 * The ONE "best intelligence per dollar" ranking. Three prompt builders
 * (engine buildContext, brief, debate realist) used to carry their own copy
 * of the ratio sort, and two of them divided by `price` with no guard — a
 * free SKU (price 0) sorted as Infinity to the top, and two zero-price
 * models made the comparator return NaN. All three call sites import this.
 *
 * Pure module: no DB/LLM imports.
 */
import type { AaModel } from '../pareto';

/**
 * Intelligence floor for a "value pick": below this a model is too weak to
 * recommend at any price, so a rock-bottom price cannot buy its way into the
 * prompt. Matches the floor engine.ts's inline copy always used.
 */
export const VALUE_PICK_MIN_INTELLIGENCE = 25;

/**
 * Models ranked by intelligence per blended dollar, strongest first.
 * Guards: price must be > 0 (free/unpriced SKUs are excluded, never Infinity)
 * and intelligence must clear the floor, so the comparator only ever sees
 * finite positive ratios.
 */
export function valuePicks(
  models: readonly AaModel[],
  opts: { limit: number; requireBothSides?: boolean },
): AaModel[] {
  return models
    .filter(
      (m) =>
        m.price > 0 &&
        m.intelligence >= VALUE_PICK_MIN_INTELLIGENCE &&
        (!opts.requireBothSides || (m.priceIn !== null && m.priceOut !== null)),
    )
    .sort((a, b) => b.intelligence / b.price - a.intelligence / a.price)
    .slice(0, opts.limit);
}

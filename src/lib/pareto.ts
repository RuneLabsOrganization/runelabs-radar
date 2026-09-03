// Client-safe module: no DB or node imports (ModelScatter runs in the browser).

export interface AaModel {
  name: string;
  org: string | null;
  intelligence: number;
  coding: number | null;
  price: number; // $/1M tokens, blended 3:1
  priceIn: number | null; // $/1M input tokens
  priceOut: number | null; // $/1M output tokens
  speed: number | null; // median output tok/s
  released: string | null;
}

/**
 * Pareto frontier for a "cheaper is better, higher is better" scatter: a point
 * is on the frontier when no other point is both cheaper-or-equal and
 * strictly better. Two chosen semantics, documented so callers can rely on
 * them:
 *
 *   - EXACT duplicates (same x AND same y) co-exist on the frontier — neither
 *     dominates the other, and flagging only one would hide real models from
 *     the scatter's highlighted set.
 *   - an equal-y but pricier point IS off the frontier: the cheaper equal
 *     beats it on price.
 *
 * Returns a parallel boolean array.
 */
export function paretoFrontier(points: { x: number; y: number }[]): boolean[] {
  const order = points
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => a.x - b.x || b.y - a.y);
  const frontier = new Array<boolean>(points.length).fill(false);
  let bestY = -Infinity;
  let bestX = Infinity; // x at which bestY was set — duplicates of a frontier point share both
  for (const p of order) {
    if (p.y > bestY || (p.y === bestY && p.x === bestX)) {
      frontier[p.i] = true;
      bestY = p.y;
      bestX = p.x;
    }
  }
  return frontier;
}

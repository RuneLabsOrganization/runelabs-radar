// Client-safe module: no DB or node imports (ModelScatter runs in the browser).

export interface AaModel {
  name: string;
  org: string | null;
  intelligence: number;
  coding: number | null;
  price: number; // $/1M tokens, blended 3:1
  speed: number | null; // median output tok/s
  released: string | null;
}

/**
 * Pareto frontier for a "cheaper is better, higher is better" scatter: a point
 * is on the frontier when no other point is both cheaper-or-equal and
 * strictly better. Returns a parallel boolean array.
 */
export function paretoFrontier(points: { x: number; y: number }[]): boolean[] {
  const order = points
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => a.x - b.x || b.y - a.y);
  const frontier = new Array<boolean>(points.length).fill(false);
  let bestY = -Infinity;
  for (const p of order) {
    if (p.y > bestY) {
      frontier[p.i] = true;
      bestY = p.y;
    }
  }
  return frontier;
}

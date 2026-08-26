/**
 * Matching a kit pick name to a priced entity.
 *
 * Board picks carry effort/quantisation qualifiers the price series does not:
 *   "Claude Opus 5 (Adaptive Reasoning, Max Effort)"  vs  "Claude Opus 5"
 *   "Ideogram 4 (INT8 via ComfyUI)"                   vs  "Ideogram 4"
 *
 * Stripping a trailing parenthetical fixes those. What it must NOT do is
 * match across versions — and the live data is full of near-misses that a
 * prefix or contains match would happily (and wrongly) resolve:
 *
 *   pick "GPT-5.6 Sol (max)"     near-miss entity "GPT-5.5"
 *   pick "Gemini 3.7 Flash (high)"  near-miss entity "Gemini 3 Flash"
 *   pick "Claude Sonnet 5"       near-miss entity "Claude Sonnet 4.5"
 *
 * Asserting a wrong price is worse than showing none, so after the qualifier
 * is stripped the comparison is EXACT on the canonical key. Everything else
 * stays unpriced and renders honestly as "price unknown".
 *
 * One qualifier is deliberately NEVER stripped: one containing "via", which
 * marks a different runtime/deployment rather than an effort tier —
 * "Ideogram 4 (INT8 via ComfyUI)" is a free local run, not the hosted API
 * product "Ideogram 4", and must not inherit its price. Same reasoning as
 * the bare "X via Y" suffix strip below, just inside parens instead of after.
 */
import { canonicalEntityKey } from '../entity';

/**
 * Drop one trailing parenthetical qualifier, plus a bare "via <runtime>"
 * suffix. Sequential, not chained regexes: a trailing parenthetical is
 * resolved fully (stripped, or left untouched if it names a runtime) before
 * the bare "via" check ever runs, so a "via" sitting inside the parenthetical
 * can't leak out and get matched by the second step.
 */
export function stripQualifier(pickName: string): string {
  const trailingParen = pickName.match(/^(.*?)\s*(\([^()]*\))\s*$/);
  if (trailingParen) {
    const [, base, paren] = trailingParen;
    return /\bvia\b/i.test(paren) ? pickName.trim() : base.trim();
  }
  return pickName.replace(/\s+via\s+.+$/i, '').trim();
}

/**
 * The priced entity for a pick, or null when nothing matches exactly.
 * `entities` is keyed by the raw entity name as stored in metric_points.
 */
export function matchPricedEntity(pickName: string, entities: Iterable<string>): string | null {
  const wanted = canonicalEntityKey(stripQualifier(pickName));
  if (!wanted) return null;
  for (const entity of entities) {
    if (canonicalEntityKey(entity) === wanted) return entity;
  }
  return null;
}

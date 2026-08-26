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
 */
import { canonicalEntityKey } from '../entity';

/**
 * Drop one trailing parenthetical qualifier, plus "via <runtime>" suffixes.
 * Only the tail is removed — a parenthetical in the middle of a name is left
 * alone, because it is part of the name rather than a qualifier.
 */
export function stripQualifier(pickName: string): string {
  return pickName
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s+via\s+.+$/i, '')
    .trim();
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

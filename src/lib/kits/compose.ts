/**
 * The composer: (persona, tier, picks) -> costed kit.
 *
 * Pure by design — no DB, no LLM, no ambient clock. The product's four
 * honesty guarantees live here and are cheap to test because of it:
 *
 *   1. usage-priced picks NEVER enter totalUsdMonth
 *   2. a missing pick is a gap, never a substitution
 *   3. line order is the persona's route order
 *   4. a seat/free pick with no known price is UNPRICED, not free — it is
 *      never silently counted as $0. "seat, price unknown" and "free" are
 *      different facts and must not collapse into the same number. This is
 *      the same guarantee as #2 applied to price instead of to the pick
 *      itself: an unknown number is a gap in the total, not a zero.
 */
import { cellKey, type KitCell, type KitTier } from './grid';
import type { KitPersona } from './personas';
import type { Confidence } from './confidence';

export type PriceModel = 'seat' | 'usage' | 'free';

export interface PickRecord {
  category: string;
  task: string;
  tier: KitTier;
  pickName: string;
  pickUrl: string | null;
  priceModel: PriceModel;
  priceUsdMonth: number | null;
  priceNote: string | null;
  riskFlag: string | null;
  why: string | null;
  skip: string | null;
  confidence: Confidence;
  evidenceCount: number;
  verifiedAt: Date | null;
}

export interface KitLine {
  category: string;
  task: string;
  pick: PickRecord | null;
}

export interface Kit {
  persona: string;
  label: string;
  tier: KitTier;
  lines: KitLine[];
  /**
   * Sum of picks with a KNOWN price only (free counts as 0; usage is always
   * excluded; seat/free with no priceUsdMonth on file is excluded too — see
   * `unpriced`). Check `unpriced.length === 0` before presenting this as a
   * complete total.
   */
  totalUsdMonth: number;
  /** Seat/free picks covered but with no priceUsdMonth on file yet. Not billed, not zero — unknown. */
  unpriced: PickRecord[];
  usageRisk: PickRecord[];
  gaps: KitCell[];
  coveredCount: number;
  totalCount: number;
}

export interface ComposeOpts {
  /** "category/task" keys to drop entirely — the user already has these covered. */
  exclude?: string[];
}

export function composeKit(
  persona: KitPersona,
  tier: KitTier,
  picks: PickRecord[],
  opts: ComposeOpts = {},
): Kit {
  const byCell = new Map(picks.map((p) => [cellKey(p.category, p.task, p.tier), p]));
  const excluded = new Set(opts.exclude ?? []);

  const routes = persona.routes.filter((r) => !excluded.has(`${r.category}/${r.task}`));

  const lines: KitLine[] = [];
  const gaps: KitCell[] = [];
  const usageRisk: PickRecord[] = [];
  const unpriced: PickRecord[] = [];
  let totalUsdMonth = 0;

  for (const route of routes) {
    const pick = byCell.get(cellKey(route.category, route.task, tier)) ?? null;
    lines.push({ category: route.category, task: route.task, pick });

    if (!pick) {
      gaps.push({ category: route.category, task: route.task });
      continue;
    }
    if (pick.priceModel === 'usage') {
      usageRisk.push(pick);
      continue; // never billed into the total
    }
    if (pick.priceModel === 'free') {
      continue; // known to cost $0 — nothing to add, nothing unpriced
    }
    if (pick.priceUsdMonth == null) {
      unpriced.push(pick); // seat pick, price not on file — NOT zero
      continue;
    }
    totalUsdMonth += pick.priceUsdMonth;
  }

  return {
    persona: persona.slug,
    label: persona.label,
    tier,
    lines,
    totalUsdMonth: Math.round(totalUsdMonth * 100) / 100,
    unpriced,
    usageRisk,
    gaps,
    coveredCount: lines.length - gaps.length,
    totalCount: lines.length,
  };
}

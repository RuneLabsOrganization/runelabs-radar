/**
 * The composer: (persona, tier, picks) -> costed kit.
 *
 * Pure by design — no DB, no LLM, no ambient clock. The product's three
 * honesty guarantees live here and are cheap to test because of it:
 *
 *   1. usage-priced picks NEVER enter totalUsdMonth
 *   2. a missing pick is a gap, never a substitution
 *   3. line order is the persona's route order
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
  /** Seat- and free-priced picks only. Usage-priced spend is unbounded and unknowable here. */
  totalUsdMonth: number;
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
    totalUsdMonth += pick.priceUsdMonth ?? 0;
  }

  return {
    persona: persona.slug,
    label: persona.label,
    tier,
    lines,
    totalUsdMonth: Math.round(totalUsdMonth * 100) / 100,
    usageRisk,
    gaps,
    coveredCount: lines.length - gaps.length,
    totalCount: lines.length,
  };
}

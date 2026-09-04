/**
 * Conservative, public savings figures for marketing copy.
 * Source: tests/mcp-savings-bench.test.ts on a fat seeded catalog (chars÷4).
 * Round DOWN from the bench so we under-claim. DIY constants and the credit
 * rule live in mcp-diy.ts — DIY savings only earn full credit when a reply
 * carries real substance (returned ≥ 10% of the DIY budget; below that the
 * credit scales proportionally), so these figures are honest even for thin
 * replies.
 */
import { fmtCompact } from './format';

export const PUBLISHED_SAVINGS = {
  /** Mean tokens returned on compact job/read tools in the bench. */
  compactAvgReturned: 300,
  /**
   * Mean DIY tokens saved on that same compact set under the substance-scaled
   * credit rule (bench ≈ 2,398 — compact replies are small, so several earn
   * proportional rather than full credit).
   */
  compactAvgSavedVsDiy: 2_000,
  /** Mean tokens avoided vs the old pretty-printed JSON dump. */
  compactAvgSavedVsFull: 500,
  /** Full weekly markdown ÷ compact excerpt (bench ≈ 5.3×). */
  weeklyFullVsCompact: 5,
  /** generate_plan markdown vs the old JSON+markdown dual dump (bench ≈ 61%). */
  planVsDualPct: 60,
  /** DIY tokens saved by one generate_plan (bench ≈ 20,960). */
  planDiySaved: 20_000,
  /** DIY constant for ask_radar (not LLM-benched; from DIY_TOKENS.ask). */
  askDiySaved: 22_000,
  /**
   * One research→plan session: ask_radar + compact dossier + generate_plan.
   * 22k + ~3.7k + ~21k ≈ 47k on the bench; published as 45k.
   */
  sessionDiySaved: 45_000,
} as const;

export function fmtTokens(n: number): string {
  return fmtCompact(n);
}

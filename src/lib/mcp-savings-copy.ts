/**
 * Conservative, public savings figures for marketing copy.
 * Source: tests/mcp-savings-bench.test.ts on a fat seeded catalog (chars÷4).
 * Round DOWN from the bench so we under-claim. DIY constants live in mcp-economy.ts.
 */
export const PUBLISHED_SAVINGS = {
  /** Mean tokens returned on compact job/read tools in the bench. */
  compactAvgReturned: 300,
  /** Mean DIY tokens saved on that same compact set. */
  compactAvgSavedVsDiy: 8_000,
  /** Mean tokens avoided vs the old pretty-printed JSON dump. */
  compactAvgSavedVsFull: 500,
  /** Full weekly markdown ÷ compact excerpt (bench ≈ 5.3×). */
  weeklyFullVsCompact: 5,
  /** generate_plan markdown vs the old JSON+markdown dual dump (bench ≈ 61%). */
  planVsDualPct: 60,
  /** DIY tokens saved by one generate_plan (bench ≈ 25,718). */
  planDiySaved: 25_000,
  /** DIY constant for ask_radar (not LLM-benched; from DIY_TOKENS.ask). */
  askDiySaved: 22_000,
  /**
   * One research→plan session: ask_radar + compact dossier + generate_plan.
   * 22k + 8k + 25k = 55k; published as 50k.
   */
  sessionDiySaved: 50_000,
} as const;

export function fmtTokens(n: number): string {
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

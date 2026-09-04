/**
 * Client-safe DIY research budgets and the savings-credit rule, shared by the
 * live meter (mcp-economy.ts — server-only, imports the db) and the
 * landing-page demo (components/mcp-demo/script.ts — client bundle).
 * Nothing here may import server modules: this file must stay importable
 * from a browser bundle.
 */

/** Conservative DIY research budgets (user-agent tokens), not Radar COGS. */
export const DIY_TOKENS = {
  read: 2_000,
  dossier: 8_000,
  brief: 4_000,
  weekly: 12_000,
  debate: 18_000,
  plan: 28_000,
  ask: 22_000,
  scout: 16_000,
  decide: 10_000,
  relevant: 12_000,
  metrics_full: 6_000,
} as const;

export type DiyKind = keyof typeof DIY_TOKENS;

/**
 * Substance floor for DIY savings credit. A reply earns the full
 * counterfactual only when it carries minimal substance — returned tokens ≥
 * 10% of the DIY budget. Below the floor the credit scales proportionally,
 * reaching 0 for an empty reply. Without this, saved_vs_diy credited the
 * whole DIY budget whenever returned < budget, so the account counter grew
 * FASTEST when a tool returned least — a tiny or broken reply maximized
 * "savings".
 */
export const DIY_SUBSTANCE_FLOOR = 0.1;

/** DIY tokens credited for a reply of `returned` tokens against a `diy` budget. */
export function diySavings(returned: number, diy: number): number {
  const raw = Math.max(0, diy - returned);
  const substance = Math.min(1, returned / (diy * DIY_SUBSTANCE_FLOOR));
  return Math.round(raw * substance);
}

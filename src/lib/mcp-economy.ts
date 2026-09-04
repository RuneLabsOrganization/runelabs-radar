/**
 * MCP token-savings meter — ROI proof for the subscription, not a billing unit.
 * Artifact pricing stays (plans/debates/asks); this estimates how many tokens
 * the user's coding agent avoided ingesting / synthesizing locally.
 *
 * Methodology (conservative, public on /pricing):
 * - returned ≈ UTF-8 chars of the payload the agent actually sees ÷ 4
 * - counterfactual_full ≈ size of today's verbose dump for the same tool
 * - counterfactual_diy ≈ published constants for "agent does the research itself"
 * - saved = max(0, counterfactual − returned), but DIY savings only earn full
 *   credit when the reply carries minimal substance (returned ≥ 10% of the DIY
 *   budget; below that the credit scales proportionally — see mcp-diy.ts), so
 *   an empty reply can never maximize "savings"
 *
 * DIY_TOKENS/DiyKind live in mcp-diy.ts (client-safe leaf shared with the
 * landing-page demo) and are re-exported here for existing consumers.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './db';
import { mcpEconomy } from './db/schema';
import { cycleStart, entitlementFor } from './billing';
import { DIY_TOKENS, diySavings, type DiyKind } from './mcp-diy';

export { DIY_TOKENS } from './mcp-diy';
export type { DiyKind } from './mcp-diy';

export interface EconomySnapshot {
  returned: number;
  saved_vs_full: number;
  saved_vs_diy: number;
}

export interface EconomyOpts {
  /** Which DIY constant to use when estimating counterfactual research. */
  diyKind?: DiyKind;
  /** Override for the "full dump" size (chars/4). When omitted, uses returned as floor. */
  fullTokens?: number;
  /** Authenticated user to accumulate cycle totals for. */
  userId?: number | null;
}

/** Rough token estimate: 1 token ≈ 4 characters (OpenAI-style heuristic). */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function estimateTokensFromValue(value: unknown): number {
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function computeEconomy(
  returnedPayload: unknown,
  opts?: EconomyOpts,
  contentText?: string,
): EconomySnapshot {
  const returned = Math.max(
    estimateTokensFromValue(returnedPayload),
    contentText ? estimateTokens(contentText) : 0,
  );
  const full = Math.max(opts?.fullTokens ?? returned, returned);
  const diy = DIY_TOKENS[opts?.diyKind ?? 'read'];
  return {
    returned,
    saved_vs_full: Math.max(0, full - returned),
    saved_vs_diy: diySavings(returned, diy),
  };
}

/** Upsert per-user cycle aggregates. Silent no-op without a userId. */
export function recordEconomy(userId: number | null | undefined, economy: EconomySnapshot, now = new Date()): void {
  if (userId == null) return;
  const ent = entitlementFor(userId);
  const start = cycleStart(ent.resetDay, now);
  const cycleKey = start.toISOString().slice(0, 10);
  // One atomic statement (usage_counters pattern): a select-then-insert pair
  // races across processes — the loser hit the (user_id, cycle_key) unique
  // index and its savings were silently dropped by the caller's catch.
  getDb()
    .insert(mcpEconomy)
    .values({
      userId,
      cycleKey,
      calls: 1,
      tokensReturned: economy.returned,
      tokensSavedVsFull: economy.saved_vs_full,
      tokensSavedVsDiy: economy.saved_vs_diy,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [mcpEconomy.userId, mcpEconomy.cycleKey],
      set: {
        calls: sql`${mcpEconomy.calls} + 1`,
        tokensReturned: sql`${mcpEconomy.tokensReturned} + ${economy.returned}`,
        tokensSavedVsFull: sql`${mcpEconomy.tokensSavedVsFull} + ${economy.saved_vs_full}`,
        tokensSavedVsDiy: sql`${mcpEconomy.tokensSavedVsDiy} + ${economy.saved_vs_diy}`,
        updatedAt: now,
      },
    })
    .run();
}

export interface CycleEconomy {
  cycle_key: string;
  calls: number;
  tokens_returned: number;
  tokens_saved_vs_full: number;
  tokens_saved_vs_diy: number;
}

export function economyThisCycle(userId: number, now = new Date()): CycleEconomy {
  const ent = entitlementFor(userId);
  const start = cycleStart(ent.resetDay, now);
  const cycleKey = start.toISOString().slice(0, 10);
  const row = getDb()
    .select()
    .from(mcpEconomy)
    .where(and(eq(mcpEconomy.userId, userId), eq(mcpEconomy.cycleKey, cycleKey)))
    .get();
  return {
    cycle_key: cycleKey,
    calls: row?.calls ?? 0,
    tokens_returned: row?.tokensReturned ?? 0,
    tokens_saved_vs_full: row?.tokensSavedVsFull ?? 0,
    tokens_saved_vs_diy: row?.tokensSavedVsDiy ?? 0,
  };
}

/** Sum of DIY savings across all cycles (lifetime display). */
export function economyLifetimeSaved(userId: number): number {
  const row = getDb()
    .select({ n: sql<number>`coalesce(sum(${mcpEconomy.tokensSavedVsDiy}), 0)` })
    .from(mcpEconomy)
    .where(eq(mcpEconomy.userId, userId))
    .get();
  return row?.n ?? 0;
}

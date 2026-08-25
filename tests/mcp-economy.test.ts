import { describe, expect, it } from 'vitest';
import { computeEconomy, DIY_TOKENS, estimateTokens, recordEconomy, economyThisCycle } from '../src/lib/mcp-economy';
import { useTestDb } from './helpers/db';
import { users } from '../src/lib/db/schema';

describe('mcp-economy', () => {
  it('estimates tokens from char length', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });

  it('computes savings vs full and diy conservatively', () => {
    const eco = computeEconomy({ summary: 'hi' }, { diyKind: 'plan', fullTokens: 5000 });
    expect(eco.returned).toBeGreaterThan(0);
    expect(eco.saved_vs_full).toBeGreaterThan(0);
    expect(eco.saved_vs_diy).toBe(DIY_TOKENS.plan - eco.returned);
  });

  it('persists cycle aggregates per user', () => {
    const db = useTestDb();
    const u = db
      .insert(users)
      .values({ name: 'eco1', passwordHash: 'x', role: 'member' })
      .returning()
      .get();
    recordEconomy(u.id, { returned: 100, saved_vs_full: 400, saved_vs_diy: 1000 });
    recordEconomy(u.id, { returned: 50, saved_vs_full: 200, saved_vs_diy: 500 });
    const cycle = economyThisCycle(u.id);
    expect(cycle.calls).toBe(2);
    expect(cycle.tokens_returned).toBe(150);
    expect(cycle.tokens_saved_vs_diy).toBe(1500);
  });
});

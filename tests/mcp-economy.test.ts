import { describe, expect, it } from 'vitest';
import { computeEconomy, DIY_TOKENS, estimateTokens, recordEconomy, economyThisCycle } from '../src/lib/mcp-economy';
import { DIY_SUBSTANCE_FLOOR, diySavings } from '../src/lib/mcp-diy';
import { useTestDb } from './helpers/db';
import { users } from '../src/lib/db/schema';

describe('mcp-economy', () => {
  it('estimates tokens from char length', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });

  it('computes savings vs full and diy with the substance-scaled rule', () => {
    const eco = computeEconomy({ summary: 'hi' }, { diyKind: 'plan', fullTokens: 5000 });
    expect(eco.returned).toBeGreaterThan(0);
    expect(eco.saved_vs_full).toBeGreaterThan(0);
    // JUSTIFICATION (G6a): a tiny reply no longer banks the whole DIY budget —
    // below the substance floor the credit scales proportionally.
    expect(eco.saved_vs_diy).toBe(diySavings(eco.returned, DIY_TOKENS.plan));
    expect(eco.saved_vs_diy).toBeLessThan(DIY_TOKENS.plan - eco.returned);
  });

  it('credits full DIY savings once the reply has minimal substance', () => {
    // returned ≥ 10% of the DIY budget → the classic max(0, diy − returned)
    const payload = { text: 'x'.repeat(4 * DIY_SUBSTANCE_FLOOR * DIY_TOKENS.read * 2) };
    const eco = computeEconomy(payload, { diyKind: 'read' });
    expect(eco.returned).toBeGreaterThanOrEqual(DIY_TOKENS.read * DIY_SUBSTANCE_FLOOR);
    expect(eco.saved_vs_diy).toBe(DIY_TOKENS.read - eco.returned);
  });

  it('an empty reply earns ~nothing — it cannot maximize savings', () => {
    // JUSTIFICATION (G6a): previously saved_vs_diy credited the full DIY
    // constant whenever returned < constant, so the account counter grew
    // FASTEST when the tool returned least.
    const empty = computeEconomy({}, { diyKind: 'plan' });
    expect(empty.saved_vs_diy).toBeLessThanOrEqual(Math.ceil(DIY_TOKENS.plan * 0.01));

    const substantive = computeEconomy({ text: 'x'.repeat(40_000) }, { diyKind: 'plan' });
    expect(substantive.saved_vs_diy).toBeGreaterThan(empty.saved_vs_diy);
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

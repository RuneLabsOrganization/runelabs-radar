import { beforeEach, describe, expect, it } from 'vitest';
import { can } from '@/lib/entitlements';
import { llmCalls, planEntitlements } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function setTier(db: Db, userId: number, tier: 'free' | 'builder' | 'factory') {
  db.insert(planEntitlements)
    .values({ userId, tier, plansPerMonth: 30, resetDay: 1 })
    .run();
}

function burn(db: Db, userId: number, feature: string, n: number) {
  for (let i = 0; i < n; i++) {
    db.insert(llmCalls)
      .values({
        ts: new Date(), feature, userId, model: 'test',
        promptTokens: 1, completionTokens: 1, durationMs: 1, estCostUsd: 0,
      })
      .run();
  }
}

describe('ladder entitlements', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    // plan_entitlements FKs to users.id
    for (const id of [1, 2, 3, 4]) seedUser(db, id);
  });

  it('gives free tier a small refine quota', () => {
    const gate = can({ id: 1 }, 'lead_refine');
    expect(gate.ok).toBe(true);
    expect(gate.quota).toBe(3);
  });

  it('blocks free tier once the refine quota is spent', () => {
    burn(db, 1, 'lead_refine', 3);
    const gate = can({ id: 1 }, 'lead_refine');
    expect(gate.ok).toBe(false);
    expect(gate.upgradeHint).toBeTruthy();
  });

  it('gives builder a much larger refine quota', () => {
    setTier(db, 2, 'builder');
    burn(db, 2, 'lead_refine', 10);
    const gate = can({ id: 2 }, 'lead_refine');
    expect(gate.ok).toBe(true);
    expect(gate.quota).toBe(50);
  });

  it('denies forge on free tier', () => {
    const gate = can({ id: 1 }, 'forge');
    expect(gate.ok).toBe(false);
  });

  it('allows forge on builder within quota and blocks past it', () => {
    setTier(db, 3, 'builder');
    expect(can({ id: 3 }, 'forge').ok).toBe(true);
    // each forge writes 4 llm_calls rows (advocate/skeptic/realist/judge)
    burn(db, 3, 'forge', 5 * 4);
    expect(can({ id: 3 }, 'forge').ok).toBe(false);
  });

  it('gives factory unlimited refines', () => {
    setTier(db, 4, 'factory');
    burn(db, 4, 'lead_refine', 500);
    expect(can({ id: 4 }, 'lead_refine').ok).toBe(true);
  });

  it('refuses both capabilities for a signed-out caller', () => {
    expect(can(null, 'lead_refine').ok).toBe(false);
    expect(can(null, 'forge').ok).toBe(false);
  });
});

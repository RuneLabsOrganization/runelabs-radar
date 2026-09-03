import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { admitPlanGeneration, usageThisCycle } from '@/lib/billing';
import { can } from '@/lib/entitlements';
import { llmCalls, planEntitlements } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

// 3.3c: plan admission is atomic in-process — the quota check and the
// slot-reserving insert are one synchronous critical section, so interleaved
// check-then-act sequences can no longer both pass.
describe('admitPlanGeneration', () => {
  let db: Db;
  let userId: number;
  beforeEach(() => {
    db = useTestDb();
    userId = seedUser(db);
    db.insert(planEntitlements).values({ userId, tier: 'free', plansPerMonth: 1, resetDay: 1 }).run();
  });

  it('two interleaved can()+admit sequences admit exactly one at quota 1', async () => {
    const attempt = async (): Promise<boolean> => {
      const gate = can({ id: userId }, 'plan');
      // the check-then-act gap a real caller has between gate and generation
      await Promise.resolve();
      if (!gate.ok) return false;
      return admitPlanGeneration(userId).ok;
    };
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(usageThisCycle(userId)).toBe(1);
  });

  it('the admission row is real quota: a second admission is refused while the first is held', () => {
    const first = admitPlanGeneration(userId);
    expect(first).toMatchObject({ ok: true, tier: 'free', used: 0, quota: 1 });
    expect(first.admissionId).not.toBeNull();

    const second = admitPlanGeneration(userId);
    expect(second).toMatchObject({ ok: false, used: 1, quota: 1 });
    expect(second.admissionId).toBeNull();

    // the held slot is a plain feature='plan' llm_calls row
    const rows = db.select().from(llmCalls).where(eq(llmCalls.userId, userId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'plan', userId, model: 'plan-admission' });
  });

  it('rejects at quota 0 (admin zero-override) without writing a row', () => {
    db.update(planEntitlements).set({ plansPerMonth: 0 }).where(eq(planEntitlements.userId, userId)).run();
    const admission = admitPlanGeneration(userId);
    expect(admission.ok).toBe(false);
    expect(admission.admissionId).toBeNull();
    expect(db.select().from(llmCalls).all()).toHaveLength(0);
  });
});

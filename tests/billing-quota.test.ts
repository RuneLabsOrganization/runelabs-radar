import { beforeEach, describe, expect, it } from 'vitest';
import { admitPlanGeneration, canGeneratePlan, entitlementFor, planQuota } from '@/lib/billing';
import { can } from '@/lib/entitlements';
import { planEntitlements } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

// B1: a per-user plansPerMonth override must win over the tier cap — including
// 0 (an admin zero-quota blocks) — and the two plan gates (billing.canGeneratePlan,
// entitlements.can) must resolve the quota identically via planQuota.
describe('plan quota resolution (per-user override vs tier cap)', () => {
  let db: Db;
  let userId: number;
  beforeEach(() => {
    db = useTestDb();
    userId = seedUser(db);
  });

  it('planQuota: null override falls back to the tier cap', () => {
    expect(planQuota({ tier: 'free', plansPerMonth: null })).toBe(3);
    expect(planQuota({ tier: 'builder', plansPerMonth: null })).toBe(30);
    expect(planQuota({ tier: 'factory', plansPerMonth: null })).toBe(100);
  });

  it('planQuota: an explicit override wins, including 0', () => {
    expect(planQuota({ tier: 'builder', plansPerMonth: 0 })).toBe(0);
    expect(planQuota({ tier: 'free', plansPerMonth: 7 })).toBe(7);
  });

  it('admin-set plansPerMonth=0 blocks every plan gate', () => {
    db.insert(planEntitlements).values({ userId, tier: 'builder', plansPerMonth: 0, resetDay: 1 }).run();
    const gate = can({ id: userId }, 'plan');
    expect(gate.ok).toBe(false);
    expect(gate.quota).toBe(0);
    expect(canGeneratePlan(userId)).toMatchObject({ ok: false, tier: 'builder', used: 0, quota: 0 });
    const admission = admitPlanGeneration(userId);
    expect(admission).toMatchObject({ ok: false, quota: 0 });
    expect(admission.admissionId).toBeNull();
  });

  it('no entitlement row → all gates fall back to the free tier cap', () => {
    expect(entitlementFor(userId)).toEqual({ tier: 'free', plansPerMonth: 3, resetDay: 1 });
    expect(can({ id: userId }, 'plan')).toMatchObject({ ok: true, quota: 3 });
    expect(canGeneratePlan(userId)).toMatchObject({ ok: true, quota: 3 });
  });

  it('a non-zero override beats the tier cap in both gates', () => {
    db.insert(planEntitlements).values({ userId, tier: 'free', plansPerMonth: 10, resetDay: 1 }).run();
    expect(can({ id: userId }, 'plan')).toMatchObject({ ok: true, quota: 10 });
    expect(canGeneratePlan(userId)).toMatchObject({ ok: true, quota: 10 });
  });
});

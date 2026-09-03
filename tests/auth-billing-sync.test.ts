import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { authUser, planEntitlements, users } from '@/lib/db/schema';
import { quotaFor } from '@/lib/billing';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
});

// Dynamic import, like tests/auth-linking.test.ts: better-auth.ts calls
// getDb() at module scope, so it must load after useTestDb installs the db.
async function loadBilling() {
  const mod = await import('@/lib/auth/better-auth');
  return { setTierForAuthUser: mod.setTierForAuthUser, handleStripeEvent: mod.handleStripeEvent };
}

function seedDomainUser(authUserId: string): number {
  return db
    .insert(users)
    .values({ name: `u-${authUserId}`, passwordHash: '', authUserId })
    .returning({ id: users.id })
    .get().id;
}

function seedEntitlement(userId: number, tier: 'free' | 'builder' | 'factory', plansPerMonth: number): void {
  db.insert(planEntitlements).values({ userId, tier, plansPerMonth, resetDay: 1 }).run();
}

function entitlement(userId: number) {
  return db.select().from(planEntitlements).where(eq(planEntitlements.userId, userId)).get();
}

describe('setTierForAuthUser quota preservation', () => {
  it('inserts the tier default when no entitlement row exists', async () => {
    const { setTierForAuthUser } = await loadBilling();
    const uid = seedDomainUser('auth-new');
    setTierForAuthUser('auth-new', 'builder');
    expect(entitlement(uid)).toMatchObject({ tier: 'builder', plansPerMonth: quotaFor('builder') });
  });

  it('applies the new tier’s default quota on a real tier change', async () => {
    const { setTierForAuthUser } = await loadBilling();
    const uid = seedDomainUser('auth-upgrade');
    seedEntitlement(uid, 'builder', quotaFor('builder'));
    setTierForAuthUser('auth-upgrade', 'factory');
    expect(entitlement(uid)).toMatchObject({ tier: 'factory', plansPerMonth: quotaFor('factory') });
  });

  it('preserves an admin-granted custom quota on a renewal event (same tier)', async () => {
    const { setTierForAuthUser } = await loadBilling();
    const uid = seedDomainUser('auth-custom');
    seedEntitlement(uid, 'builder', 999); // admin override, not the builder default
    setTierForAuthUser('auth-custom', 'builder');
    expect(entitlement(uid)).toMatchObject({ tier: 'builder', plansPerMonth: 999 });
  });

  it('keeps the custom quota sticky across tier changes and downgrades', async () => {
    const { setTierForAuthUser } = await loadBilling();
    const uid = seedDomainUser('auth-sticky');
    seedEntitlement(uid, 'builder', 999);
    setTierForAuthUser('auth-sticky', 'factory');
    expect(entitlement(uid)).toMatchObject({ tier: 'factory', plansPerMonth: 999 });
    setTierForAuthUser('auth-sticky', 'free');
    expect(entitlement(uid)).toMatchObject({ tier: 'free', plansPerMonth: 999 });
  });

  it('is a no-op for an unknown auth user', async () => {
    const { setTierForAuthUser } = await loadBilling();
    expect(() => setTierForAuthUser('auth-ghost', 'builder')).not.toThrow();
  });
});

describe('handleStripeEvent — charge.refunded', () => {
  function seedSubscriber(stripeCustomerId: string): number {
    db.insert(authUser)
      .values({
        id: 'auth-sub',
        name: 'subscriber',
        email: 'subscriber@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        stripeCustomerId,
      })
      .run();
    const uid = seedDomainUser('auth-sub');
    seedEntitlement(uid, 'builder', quotaFor('builder'));
    return uid;
  }

  it('downgrades to free on a full refund', async () => {
    const { handleStripeEvent } = await loadBilling();
    const uid = seedSubscriber('cus_full');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_full', amount: 1900, amount_refunded: 1900 } },
    });

    expect(entitlement(uid)?.tier).toBe('free');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('downgrading to free'));
    warn.mockRestore();
  });

  it('keeps the tier on a partial refund but logs for ops', async () => {
    const { handleStripeEvent } = await loadBilling();
    const uid = seedSubscriber('cus_partial');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { id: 'ch_2', customer: 'cus_partial', amount: 1900, amount_refunded: 500 } },
    });

    expect(entitlement(uid)?.tier).toBe('builder');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('partial refund'));
    warn.mockRestore();
  });

  it('warns and changes nothing for an unknown Stripe customer', async () => {
    const { handleStripeEvent } = await loadBilling();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleStripeEvent({
      type: 'charge.refunded',
      data: { object: { id: 'ch_3', customer: 'cus_ghost', amount: 1900, amount_refunded: 1900 } },
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown Stripe customer'));
    warn.mockRestore();
  });

  it('ignores unrelated event types', async () => {
    const { handleStripeEvent } = await loadBilling();
    const uid = seedSubscriber('cus_other');

    await handleStripeEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_other' } },
    });

    expect(entitlement(uid)?.tier).toBe('builder');
  });
});

import { describe, expect, it } from 'vitest';
import { can } from '../src/lib/entitlements';
import { useTestDb } from './helpers/db';
import { planEntitlements, users } from '../src/lib/db/schema';

describe('entitlements.can', () => {
  it('denies anonymous for generative actions', () => {
    useTestDb();
    expect(can(null, 'plan').ok).toBe(false);
    expect(can(null, 'debate').ok).toBe(false);
    expect(can(null, 'batch_run').ok).toBe(false);
  });

  it('allows votes for any signed-in user', () => {
    const db = useTestDb();
    const u = db
      .insert(users)
      .values({ name: 'member1', passwordHash: 'x', role: 'member' })
      .returning()
      .get();
    expect(can(u, 'vote').ok).toBe(true);
    expect(can(u, 'verdict').ok).toBe(true);
  });

  it('gates batch_run behind builder', () => {
    const db = useTestDb();
    const u = db
      .insert(users)
      .values({ name: 'free1', passwordHash: 'x', role: 'member' })
      .returning()
      .get();
    expect(can(u, 'batch_run').ok).toBe(false);
    db.insert(planEntitlements)
      .values({ userId: u.id, tier: 'builder', plansPerMonth: 30, resetDay: 1 })
      .run();
    expect(can(u, 'batch_run').ok).toBe(true);
  });
});

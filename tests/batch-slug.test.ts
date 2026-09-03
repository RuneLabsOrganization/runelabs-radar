import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { batches, planEntitlements } from '@/lib/db/schema';
import { createWorkspaceBatch } from '@/lib/batches';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('createWorkspaceBatch slug race', () => {
  let db: Db;
  let userId: number;
  beforeEach(() => {
    db = useTestDb();
    userId = seedUser(db);
    // builder allows 10 workspace batches — headroom for both creates below
    db.insert(planEntitlements).values({ userId, tier: 'builder', plansPerMonth: 30, resetDay: 1 }).run();
  });

  it('retries with a suffixed slug instead of throwing when the base slug is taken', () => {
    const first = createWorkspaceBatch(userId, 'My Title');
    expect(first.slug).toBe('my-title');

    // the unique batches.slug violation must not escape — one timestamp-suffixed retry
    const second = createWorkspaceBatch(userId, 'My Title');
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug).toMatch(/^my-title-[a-z0-9]+$/);
    expect(second.id).not.toBe(first.id);
    expect(second.title).toBe('My Title');

    const rows = db.select().from(batches).where(eq(batches.ownerId, userId)).all();
    expect(rows).toHaveLength(2);
  });

  it('keeps using the clean slug when there is no conflict', () => {
    const batch = createWorkspaceBatch(userId, 'Fresh Idea');
    expect(batch.slug).toBe('fresh-idea');
  });
});

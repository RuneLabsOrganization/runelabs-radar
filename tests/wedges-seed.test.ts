import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedWedges, WEDGE_AXES } from '@/lib/opportunities/wedges';
import { wedgeValues } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('wedge taxonomy seed', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('seeds every axis with at least four values', () => {
    seedWedges();
    for (const axis of WEDGE_AXES) {
      const rows = db.select().from(wedgeValues).where(eq(wedgeValues.axis, axis)).all();
      expect(rows.length, `axis ${axis}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('is idempotent — re-seeding does not duplicate', () => {
    seedWedges();
    const first = db.select().from(wedgeValues).all().length;
    seedWedges();
    expect(db.select().from(wedgeValues).all().length).toBe(first);
  });

  it('stores tag arrays as parseable JSON arrays', () => {
    seedWedges();
    for (const row of db.select().from(wedgeValues).all()) {
      expect(Array.isArray(JSON.parse(row.requiresTags))).toBe(true);
      expect(Array.isArray(JSON.parse(row.excludesTags))).toBe(true);
    }
  });
});

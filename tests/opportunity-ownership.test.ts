import { beforeEach, describe, expect, it } from 'vitest';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(db: Db, slug: string, ownerUserId: number | null) {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug,
      ownerUserId,
      title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
      sector: 'devtools',
      status: 'active',
      flipScore: 60,
      holdScore: 40,
      scores: '{}',
      evidence: '[]',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();
}

describe('opportunity ownership', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('allows the same slug for two different owners', () => {
    seedOpp(db, 'bulk-bg-removal', 1);
    expect(() => seedOpp(db, 'bulk-bg-removal', 2)).not.toThrow();
    const rows = db.select().from(opportunities).all();
    expect(rows).toHaveLength(2);
  });

  it('allows a private row alongside a public row with the same slug', () => {
    seedOpp(db, 'shared-slug', null);
    expect(() => seedOpp(db, 'shared-slug', 7)).not.toThrow();
  });

  it('still rejects two public rows with the same slug', () => {
    seedOpp(db, 'canonical-opening', null);
    expect(() => seedOpp(db, 'canonical-opening', null)).toThrow(/UNIQUE/i);
  });

  it('still rejects a duplicate slug for the same owner', () => {
    seedOpp(db, 'my-opening', 3);
    expect(() => seedOpp(db, 'my-opening', 3)).toThrow(/UNIQUE/i);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { persistScoutDrafts } from '@/lib/opportunities/persist-scout';
import { opportunities } from '@/lib/db/schema';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import type { OppDraft } from '@/lib/opportunities/engine';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string): OppDraft {
  const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 12])) as OppDraft['sub'];
  return {
    slug,
    title: `Title for ${slug}`,
    thesis: 'A sufficiently long thesis to satisfy the sanitizer and the gate.',
    sector: 'devtools',
    window: '6 months',
    windowMonths: 6,
    sub,
    kpis: {
      initialCostUsd: 100, monthlyCostUsd: 50, priceUsd: 30, timeToMvpDays: 14,
      breakEvenCustomers: 5, competitorCount: 3, competitionNote: null, regulatoryNote: null,
    },
    evidenceRefs: ['P1'],
  };
}

describe('scout persistence is owner-scoped', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('writes private rows that never appear on the public radar', () => {
    persistScoutDrafts([draft('alice-opening')], 1);
    const publicRows = db
      .select()
      .from(opportunities)
      .where(isNull(opportunities.ownerUserId))
      .all();
    expect(publicRows).toHaveLength(0);

    const mine = db
      .select()
      .from(opportunities)
      .where(eq(opportunities.ownerUserId, 1))
      .all();
    expect(mine).toHaveLength(1);
    expect(mine[0].slug).toBe('alice-opening');
  });

  it('lets two owners hold the same slug without collision', () => {
    const a = persistScoutDrafts([draft('same-idea')], 1);
    const b = persistScoutDrafts([draft('same-idea')], 2);
    expect(a.persisted[0].created).toBe(true);
    expect(b.persisted[0].created).toBe(true);
    expect(a.persisted[0].id).not.toBe(b.persisted[0].id);
  });

  it('upserts within one owner rather than duplicating', () => {
    persistScoutDrafts([draft('repeat-idea')], 1);
    const second = persistScoutDrafts([draft('repeat-idea')], 1);
    expect(second.persisted[0].created).toBe(false);
    const mine = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).all();
    expect(mine).toHaveLength(1);
  });

  it('drops drafts for anonymous callers instead of writing them publicly', () => {
    const res = persistScoutDrafts([draft('anon-opening')], null);
    expect(res.persisted).toHaveLength(0);
    expect(db.select().from(opportunities).all()).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { persistScoutDrafts } from '@/lib/opportunities/persist-scout';
import { opportunities } from '@/lib/db/schema';
import { compositeScore, FLIP_WEIGHTS, HOLD_WEIGHTS, SUB_KEYS } from '@/lib/opportunities/axes';
import { applyGate, unverifiedCritic } from '@/lib/opportunities/gate';
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

describe('scout persistence lets unverified drafts reach reject', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  function withSub(slug: string, fill: number, overrides: Partial<OppDraft['sub']> = {}): OppDraft {
    const sub = { ...Object.fromEntries(SUB_KEYS.map((k) => [k, fill])), ...overrides } as OppDraft['sub'];
    return { ...draft(slug), sub };
  }

  function gateOf(d: OppDraft) {
    return applyGate(
      {
        sub: d.sub,
        kpis: d.kpis,
        windowMonths: d.windowMonths,
        evidenceCount: d.evidenceRefs.length,
        legacy: false,
      },
      unverifiedCritic(d.slug),
    );
  }

  it('rejects when both flip and hold are below 45 and records the flag', () => {
    const d = withSub('weak-both', 8);
    expect(compositeScore(d.sub, FLIP_WEIGHTS)).toBeLessThan(45);
    expect(compositeScore(d.sub, HOLD_WEIGHTS)).toBeLessThan(45);
    const before = gateOf(d);
    expect(before.verdict).toBe('watch');
    expect(before.flipScore).toBeLessThan(45);
    expect(before.holdScore).toBeLessThan(45);

    persistScoutDrafts([d], 1);
    const row = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).get()!;
    const review = JSON.parse(row.review ?? '{}') as { flags: string[] };
    expect(row.verdict).toBe('reject');
    expect(review.flags).toContain('weak-unverified-auto-reject');
    expect(row.confidence).toBe(before.confidence);
  });

  it('stays watch when at least one strategy clears 45 and does not add the flag', () => {
    const d = withSub('strong-flip', 4, { buildability: 20, timing: 20 });
    const before = gateOf(d);
    expect(before.flipScore >= 45 || before.holdScore >= 45).toBe(true);
    expect(before.verdict).toBe('watch');

    persistScoutDrafts([d], 1);
    const row = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).get()!;
    const review = JSON.parse(row.review ?? '{}') as { flags: string[] };
    expect(row.verdict).toBe('watch');
    expect(review.flags).not.toContain('weak-unverified-auto-reject');
    expect(row.confidence).toBe(before.confidence);
  });
});

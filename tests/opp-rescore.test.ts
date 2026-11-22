import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { opportunities } from '@/lib/db/schema';
import { SUB_KEYS } from '@/lib/opportunities/axes';
import type { CriticResult, Verdict } from '@/lib/opportunities/gate';
import { runCritique } from '@/lib/opportunities/critic';
import { runOppRescore } from '@/lib/opportunities/rescore';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

vi.mock('@/lib/opportunities/critic', () => ({ runCritique: vi.fn() }));
const critique = vi.mocked(runCritique);

const SCORES = JSON.stringify(Object.fromEntries(SUB_KEYS.map((k) => [k, 14])));
const EVIDENCE = JSON.stringify([
  { type: 'story', label: 'one' },
  { type: 'pain', label: 'two' },
  { type: 'launch', label: 'three' },
]);

function seed(db: Db, n: number): void {
  const now = new Date();
  for (let i = 0; i < n; i++) {
    db.insert(opportunities)
      .values({
        slug: `opp-${i}`,
        title: `Opp ${i}`,
        thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
        sector: 'devtools',
        status: 'active',
        flipScore: 60,
        holdScore: 60,
        scores: SCORES,
        evidence: EVIDENCE,
        verdict: 'reject',
        confidence: 90,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();
  }
}

const review = (slug: string, verdict: Verdict): CriticResult => ({
  slug,
  verdict,
  confidence: 70,
  killRisks: [],
  adjustments: [],
  flags: [],
});

describe('runOppRescore', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    critique.mockReset();
  });

  it('reviews in small batches instead of one call for every active row', async () => {
    seed(db, 14);
    critique.mockImplementation(async (drafts) => new Map(drafts.map((d) => [d.slug, review(d.slug, 'watch')])));
    const res = await runOppRescore();
    expect(critique.mock.calls.map((c) => c[0].length)).toEqual([6, 6, 2]);
    expect(res).toMatchObject({ considered: 14, rescored: 14, unreviewed: 0 });
  });

  it('writes the new verdict for reviewed rows', async () => {
    seed(db, 2);
    critique.mockImplementation(async (drafts) => new Map(drafts.map((d) => [d.slug, review(d.slug, 'watch')])));
    await runOppRescore();
    const rows = db.select().from(opportunities).all();
    expect(rows.every((r) => r.verdict === 'watch')).toBe(true);
    expect(rows.every((r) => r.reviewedAt !== null)).toBe(true);
  });

  it('leaves a row the critic could not review untouched — never stamps it "unverified"', async () => {
    seed(db, 8);
    // first batch fails outright (runCritique returns null on an LLM error), second succeeds
    critique
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async (drafts) => new Map(drafts.map((d) => [d.slug, review(d.slug, 'watch')])));
    const res = await runOppRescore();
    expect(res).toMatchObject({ rescored: 2, unreviewed: 6 });
    const byVerdict = db.select().from(opportunities).all().reduce<Record<string, number>>((acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    }, {});
    expect(byVerdict).toEqual({ reject: 6, watch: 2 });
    const untouched = db.select().from(opportunities).where(eq(opportunities.slug, 'opp-0')).get()!;
    expect(untouched.confidence).toBe(90); // not reset to the unverified 40
  });
});

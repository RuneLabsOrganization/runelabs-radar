import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { opportunities, painPoints, stories } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

vi.mock('@/lib/llm/minimax', () => ({
  chatJSON: vi.fn(),
  LlmError: class LlmError extends Error {},
  drainLlmUsageStats: () => ({ calls: 0, promptTokens: 0, completionTokens: 0 }),
}));
// eslint-disable-next-line import/first
import { chatJSON } from '@/lib/llm/minimax';
// eslint-disable-next-line import/first
import {
  compositeScore,
  FLIP_WEIGHTS,
  HOLD_WEIGHTS,
  normalizeSlug,
  runOpportunities,
  sanitizeKpis,
  sanitizeOpportunities,
  SUB_KEYS,
  type SubScores,
} from '@/lib/opportunities/engine';
// eslint-disable-next-line import/first
import { sanitizeBrief } from '@/lib/opportunities/brief';
// eslint-disable-next-line import/first
import { KPI_BOUNDS } from '@/lib/opportunities/kpi-bounds';
// eslint-disable-next-line import/first
import { MIN_SIGNALS } from '@/lib/opportunities/signals';

const BASE: SubScores = {
  demand: 10,
  buildability: 10,
  margin: 10,
  competition: 10,
  timing: 10,
  moat: 10,
  regClear: 10,
  platformSafe: 10,
  distribution: 10,
  qualityBar: 10,
};
const SPEEDY: SubScores = { ...BASE, buildability: 20, timing: 20, distribution: 18, margin: 4, moat: 3 };
const CASHCOW: SubScores = { ...BASE, margin: 20, demand: 18, moat: 18, buildability: 6, timing: 5 };

describe('scoring', () => {
  it('flip favors speed+window, hold favors margin+demand — orderings flip between plays', () => {
    expect(compositeScore(SPEEDY, FLIP_WEIGHTS)).toBeGreaterThan(compositeScore(CASHCOW, FLIP_WEIGHTS));
    expect(compositeScore(CASHCOW, HOLD_WEIGHTS)).toBeGreaterThan(compositeScore(SPEEDY, HOLD_WEIGHTS));
  });

  it('is bounded 0..100 and both weight sets sum to 1', () => {
    const zeros = Object.fromEntries(SUB_KEYS.map((k) => [k, 0])) as SubScores;
    const maxed = Object.fromEntries(SUB_KEYS.map((k) => [k, 20])) as SubScores;
    expect(compositeScore(zeros, FLIP_WEIGHTS)).toBe(0);
    expect(compositeScore(maxed, FLIP_WEIGHTS)).toBe(100);
    expect(compositeScore(maxed, HOLD_WEIGHTS)).toBe(100);
    expect(SUB_KEYS.reduce((a, k) => a + FLIP_WEIGHTS[k], 0)).toBeCloseTo(1, 8);
    expect(SUB_KEYS.reduce((a, k) => a + HOLD_WEIGHTS[k], 0)).toBeCloseTo(1, 8);
  });

  it('sanitizeKpis clamps out-of-range numbers instead of nulling them (fail-closed F2)', () => {
    const clamped: string[] = [];
    const k = sanitizeKpis({
      initialCostUsd: 450,
      monthlyCostUsd: -3,
      priceUsd: 29.999,
      timeToMvpDays: 900,
      breakEvenCustomers: 4,
      competitorCount: 3,
      competitionNote: 'remove.bg\nand canva dominate',
      regulatoryNote: null,
    }, clamped);
    expect(k.initialCostUsd).toBe(450);
    // pre-fix these nulled out and skipped the R8 economics check entirely —
    // now they clamp to the bound and the clamp is recorded for the gate trail
    expect(k.monthlyCostUsd).toBe(0); // negative clamps to the 0 floor
    expect(k.timeToMvpDays).toBe(365); // over the cap clamps to the cap
    expect(clamped.sort()).toEqual(['monthlyCostUsd', 'timeToMvpDays']);
    expect(k.priceUsd).toBe(30);
    expect(k.competitionNote).toBe('remove.bg and canva dominate'); // newline flattened
    expect(k.regulatoryNote).toBeNull();
    // non-numbers/non-finite are unclampable — those still null out
    expect(sanitizeKpis('garbage')).toMatchObject({ initialCostUsd: null, competitorCount: null });
    expect(sanitizeKpis({ priceUsd: 'free', monthlyCostUsd: NaN })).toMatchObject({
      priceUsd: null,
      monthlyCostUsd: null,
    });
  });

  it('shares one set of KPI bounds with sanitizeBrief (F2 unification)', () => {
    // the same absurd price is judged identically on both paths: the engine
    // clamps+flags it, the brief nulls it — but the BOUND is the same number
    const clamped: string[] = [];
    const k = sanitizeKpis({ priceUsd: 50_000, monthlyCostUsd: 200_000 }, clamped);
    expect(k.priceUsd).toBe(KPI_BOUNDS.priceUsd);
    expect(k.monthlyCostUsd).toBe(KPI_BOUNDS.monthlyCostUsd);
    expect(clamped.sort()).toEqual(['monthlyCostUsd', 'priceUsd']);
    const brief = sanitizeBrief({
      icp: 'E-commerce operators with large catalogs who pay per-image editors',
      mvp: ['upload API', 'background removal worker', 'credit billing'],
      gtm: ['shopify app store'],
      risks: ['platform dependency'],
      unitEconomics: { assumptions: [], monthlyCostUsd: 200_000, suggestedPriceUsd: 50_000, breakEvenCustomers: 3 },
    })!;
    expect(brief.unitEconomics.suggestedPriceUsd).toBeNull(); // brief keeps its null semantics
    expect(brief.unitEconomics.monthlyCostUsd).toBeNull();
    // but inside the shared bounds both paths accept the same values
    const inBounds = sanitizeKpis({ priceUsd: KPI_BOUNDS.priceUsd, monthlyCostUsd: KPI_BOUNDS.monthlyCostUsd });
    expect(inBounds.priceUsd).toBe(KPI_BOUNDS.priceUsd);
    expect(inBounds.monthlyCostUsd).toBe(KPI_BOUNDS.monthlyCostUsd);
  });

  it('normalizeSlug produces stable kebab ids', () => {
    expect(normalizeSlug('Bulk BG-Removal (Shopify)!')).toBe('bulk-bg-removal-shopify');
    expect(normalizeSlug('  --Weird__Slug--  ')).toBe('weird-slug');
  });

  it('normalizeSlug is idempotent at the truncation boundary (review finding)', () => {
    const long = 'a'.repeat(59) + ' more words here';
    const once = normalizeSlug(long);
    expect(normalizeSlug(once)).toBe(once);
    expect(once.endsWith('-')).toBe(false);
  });
});

describe('sanitizeOpportunities', () => {
  const fullScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 14])) as SubScores;
  const valid = {
    slug: 'shopify-bg-removal',
    title: 'Bulk background removal for Shopify sellers',
    thesis: 'Image models crossed the cost floor while sellers keep asking for batch tools nobody ships.',
    sector: 'image',
    window: '4-8 weeks',
    subScores: { ...fullScores, demand: 16, buildability: 18 },
    kpis: { initialCostUsd: 300, timeToMvpDays: 10, competitorCount: 2 },
    evidenceRefs: ['P1', 'M', 'BOGUS'],
  };
  const refs = new Set(['P1', 'P2', 'M', 'S1']);

  it('accepts valid drafts, filters unknown refs, clamps subscores, carries kpis', () => {
    const out = sanitizeOpportunities([valid, { ...valid, slug: 'other-slug', subScores: { ...valid.subScores, demand: 99 } }], refs);
    expect(out).toHaveLength(2);
    expect(out[0].evidenceRefs).toEqual(['P1', 'M']);
    expect(out[0].kpis.initialCostUsd).toBe(300);
    expect(out[0].kpis.competitorCount).toBe(2);
    expect(out[1].sub.demand).toBe(20); // clamped
  });

  it('canonicalizes bracketed/cased/padded refs as the model echoes them (review finding)', () => {
    const out = sanitizeOpportunities([{ ...valid, evidenceRefs: ['[P1]', ' [M] ', 'p2', '[BOGUS]'] }], refs);
    expect(out[0].evidenceRefs).toEqual(['P1', 'M', 'P2']);
  });

  it('rejects missing subscores, dup slugs, short theses', () => {
    const out = sanitizeOpportunities(
      [
        { ...valid, subScores: { demand: 10 } }, // incomplete
        valid,
        valid, // dup slug
        { ...valid, slug: 'short-thesis', thesis: 'too short' },
        'garbage',
      ],
      refs,
    );
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('shopify-bg-removal');
  });

  it('nulls invalid sectors', () => {
    const out = sanitizeOpportunities([{ ...valid, sector: 'crypto' }], refs);
    expect(out[0].sector).toBeNull();
  });

  it('accepts a string integer sub-score and clamps it like a number', () => {
    const out = sanitizeOpportunities(
      [{ ...valid, subScores: { ...fullScores, demand: '12' } }],
      refs,
    );
    expect(out).toHaveLength(1);
    expect(out[0].sub.demand).toBe(12);
  });

  it('still rejects an object sub-score with missing-or-invalid-sub-score', () => {
    const rejects: { slug: string; reason: string }[] = [];
    const out = sanitizeOpportunities(
      [{ ...valid, subScores: { ...fullScores, demand: { value: 12 } } }],
      refs,
      rejects,
    );
    expect(out).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'missing-or-invalid-sub-score:demand')).toBe(true);
  });

  it('still rejects a non-numeric string sub-score', () => {
    const rejects: { slug: string; reason: string }[] = [];
    const out = sanitizeOpportunities(
      [{ ...valid, subScores: { ...fullScores, demand: 'twelve' } }],
      refs,
      rejects,
    );
    expect(out).toHaveLength(0);
    expect(rejects.some((r) => r.reason === 'missing-or-invalid-sub-score:demand')).toBe(true);
  });

  it('applies the SAME window ceiling as the parser and prompt (F1)', () => {
    const inContract = sanitizeOpportunities([{ ...valid, windowMonths: 36 }], refs);
    expect(inContract[0].windowMonths).toBe(36);
    // 40 > MAX_WINDOW_MONTHS → out-of-contract → falls back to parsing the window text
    const outOfContract = sanitizeOpportunities([{ ...valid, windowMonths: 40 }], refs);
    expect(outOfContract[0].windowMonths).toBe(1); // '4-8 weeks' → 1 (weeks round UP)
    // pre-fix the sanitizer allowed up to 240 while the parser stopped at 120 and the prompt asked ≤36
  });

  it('carries clamped KPI fields onto the draft for the gate trail (F2)', () => {
    const out = sanitizeOpportunities(
      [{ ...valid, kpis: { ...valid.kpis, priceUsd: 50_000 } }],
      refs,
    );
    expect(out[0].kpis.priceUsd).toBe(10_000); // clamped to the shared bound
    expect(out[0].kpiClamped).toEqual(['priceUsd']);
    const clean = sanitizeOpportunities([valid], refs);
    expect(clean[0].kpiClamped).toEqual([]);
  });
});

describe('sanitizeBrief', () => {
  const valid = {
    icp: 'Shopify store owners with 200+ SKUs doing their own product photography',
    mvp: ['bulk upload', 'batch background removal', 'export to Shopify'],
    stackVenture: 'ai-product',
    stackNotes: 'skip auth, use Shopify OAuth only',
    unitEconomics: { assumptions: ['image model at $0.002/image'], monthlyCostUsd: 40, suggestedPriceUsd: 29, breakEvenCustomers: 2 },
    gtm: ['Shopify app store'],
    risks: ['Shopify ships this natively'],
  };

  it('accepts a valid brief and validates the stack slug', () => {
    const brief = sanitizeBrief(valid)!;
    expect(brief.stackVenture).toBe('ai-product');
    expect(brief.unitEconomics.breakEvenCustomers).toBe(2);
    expect(sanitizeBrief({ ...valid, stackVenture: 'not-a-venture' })!.stackVenture).toBeNull();
  });

  it('rejects briefs missing the essentials', () => {
    expect(sanitizeBrief({ ...valid, mvp: ['one', 'two'] })).toBeNull(); // <3 features
    expect(sanitizeBrief({ ...valid, icp: 'short' })).toBeNull();
    expect(sanitizeBrief(null)).toBeNull();
  });

  it('is idempotent across the cache round-trip (review finding)', () => {
    const b = sanitizeBrief({ ...valid, mvp: ['bulk upload', 'batch background removal', 'A  b', 'export flow'] });
    expect(b).not.toBeNull();
    // whatever passed validation must still pass after store+parse
    expect(sanitizeBrief(JSON.parse(JSON.stringify(b)))).not.toBeNull();
  });

  it('drops non-finite or absurd economics', () => {
    const brief = sanitizeBrief({
      ...valid,
      unitEconomics: { assumptions: [], monthlyCostUsd: -5, suggestedPriceUsd: Infinity, breakEvenCustomers: 3.7 },
    })!;
    expect(brief.unitEconomics.monthlyCostUsd).toBeNull();
    expect(brief.unitEconomics.suggestedPriceUsd).toBeNull();
    expect(brief.unitEconomics.breakEvenCustomers).toBe(3.7);
  });
});

describe('runOpportunities lifecycle', () => {
  beforeEach(() => {
    vi.mocked(chatJSON).mockReset();
    // call 2 of every run is the red-team critique — default to "no reviews"
    // (proposals land unverified: watch/40) unless a test overrides it
    vi.mocked(chatJSON).mockResolvedValue({ reviews: [] } as never);
  });

  function seedSignal(db: ReturnType<typeof useTestDb>) {
    for (let i = 0; i < 3; i++) {
      db.insert(painPoints)
        .values({ summary: `paid need number ${i} that keeps recurring`, intensity: 2, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() })
        .run();
      db.insert(stories)
        .values({ title: `signal story ${i}`, tldr: 'tldr', status: 'curated', topScore: 80, createdAt: new Date() })
        .run();
    }
  }

  const draft = (slug: string) => ({
    slug,
    title: 'Bulk background removal for Shopify sellers',
    thesis: 'Image models crossed the cost floor while sellers keep asking for batch tools nobody ships.',
    sector: 'image',
    window: '6-9 months',
    subScores: Object.fromEntries(SUB_KEYS.map((k) => [k, 15])),
    kpis: { initialCostUsd: 250, timeToMvpDays: 9 },
    evidenceRefs: ['P1'],
  });

  it('creates new, refreshes existing (brief + firstSeenAt survive), archives stale', async () => {
    const db = useTestDb();
    seedSignal(db);
    const old = new Date(Date.now() - 9 * 864e5);
    db.insert(opportunities)
      .values({
        slug: 'refresh-me',
        title: 'Old title',
        thesis: 'Old thesis that was long enough to pass validation checks.',
        flipScore: 10,
        holdScore: 10,
        scores: '{}',
        brief: JSON.stringify({ icp: 'cached brief marker that is long enough', mvp: ['a', 'b', 'c'], gtm: ['x'], risks: ['y'], unitEconomics: { assumptions: [] } }),
        firstSeenAt: old,
        lastSeenAt: old,
      })
      .run();
    db.insert(opportunities)
      .values({
        slug: 'stale-one',
        title: 'Stale',
        thesis: 'Not re-detected for a long time, should be archived now.',
        flipScore: 5,
        holdScore: 5,
        scores: '{}',
        firstSeenAt: old,
        lastSeenAt: old,
      })
      .run();

    vi.mocked(chatJSON).mockResolvedValueOnce({
      opportunities: [draft('refresh-me'), draft('brand-new-opening')],
    } as never);

    const res = await runOpportunities();
    expect(res).toMatchObject({ proposed: 2, created: 1, refreshed: 1, archived: 1 });

    const refreshed = db.select().from(opportunities).where(eq(opportunities.slug, 'refresh-me')).get()!;
    expect(refreshed.title).toBe('Bulk background removal for Shopify sellers'); // refreshed
    expect(refreshed.brief).toContain('cached brief marker'); // brief survived
    // drizzle timestamps store unix seconds — compare at second precision
    expect(Math.floor(refreshed.firstSeenAt.getTime() / 1000)).toBe(Math.floor(old.getTime() / 1000)); // firstSeen survived
    expect(refreshed.status).toBe('active');
    expect(refreshed.flipScore).toBeGreaterThan(50);

    expect(db.select().from(opportunities).where(eq(opportunities.slug, 'stale-one')).get()!.status).toBe('archived');
  });

  it('resurrecting an archived slug clears the stale brief (review finding)', async () => {
    const db = useTestDb();
    seedSignal(db);
    const old = new Date(Date.now() - 30 * 864e5);
    db.insert(opportunities)
      .values({
        slug: 'resurrect-me',
        title: 'Old incarnation',
        thesis: 'An old thesis from a different market moment entirely.',
        status: 'archived',
        flipScore: 10,
        holdScore: 10,
        scores: '{}',
        brief: JSON.stringify({ icp: 'stale brief from months ago long enough', mvp: ['a1234', 'b1234', 'c1234'], gtm: ['x1234'], risks: ['y1234'], unitEconomics: { assumptions: [] } }),
        briefGeneratedAt: old,
        firstSeenAt: old,
        lastSeenAt: old,
      })
      .run();
    vi.mocked(chatJSON).mockResolvedValueOnce({ opportunities: [draft('resurrect-me')] } as never);
    await runOpportunities();
    const row = db.select().from(opportunities).where(eq(opportunities.slug, 'resurrect-me')).get()!;
    expect(row.status).toBe('active');
    expect(row.brief).toBeNull(); // stale brief must regenerate
  });

  it('skips when there is not enough signal', async () => {
    useTestDb();
    const res = await runOpportunities();
    expect(res).toEqual({ proposed: 0, critiqued: 0, created: 0, refreshed: 0, archived: 0, debated: 0 });
    expect(vi.mocked(chatJSON)).not.toHaveBeenCalled();
  });

  it('treats exactly MIN_SIGNALS signals as enough and one fewer as too thin (F8 boundary)', async () => {
    const db = useTestDb();
    // MIN_SIGNALS − 1 signals → no LLM spend
    for (let i = 0; i < MIN_SIGNALS - 1; i++) {
      db.insert(painPoints)
        .values({ summary: `paid need number ${i} that keeps recurring`, intensity: 2, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() })
        .run();
    }
    let res = await runOpportunities();
    expect(res.proposed).toBe(0);
    expect(vi.mocked(chatJSON)).not.toHaveBeenCalled();

    // the MIN_SIGNALS-th signal crosses the threshold — the proposer runs
    db.insert(painPoints)
      .values({ summary: 'one more paid need that crosses the threshold', intensity: 2, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() })
      .run();
    vi.mocked(chatJSON).mockResolvedValueOnce({ opportunities: [] } as never);
    res = await runOpportunities();
    expect(vi.mocked(chatJSON)).toHaveBeenCalledTimes(1);
    expect(res.proposed).toBe(0);
  });

  it('layered pipeline: critic adjustments + gate + trail persisted', async () => {
    const db = useTestDb();
    seedSignal(db);
    const d = { ...draft('layered-check'), window: '12-18 months', evidenceRefs: ['P1', 'S1'] };
    vi.mocked(chatJSON)
      .mockResolvedValueOnce({ opportunities: [d] } as never)
      .mockResolvedValueOnce({
        reviews: [
          {
            slug: 'layered-check',
            verdict: 'pursue',
            confidence: 85,
            killRisks: ['Shopify ships this natively within two releases'],
            axisAdjustments: [{ axis: 'moat', delta: -6, reason: 'no defensibility named' }],
            coherenceFlags: [],
          },
        ],
      } as never);

    const res = await runOpportunities();
    expect(res.critiqued).toBe(1);

    const row = db.select().from(opportunities).where(eq(opportunities.slug, 'layered-check')).get()!;
    expect(row.verdict).toBe('pursue');
    expect(row.confidence).toBe(85);
    expect(row.flipScore).toBe(74); // moat 15 → 9 after the critic's adjustment
    expect(row.holdScore).toBe(71);
    expect(row.windowMonths).toBe(12);
    const review = JSON.parse(row.review!);
    expect(review.killRisks).toEqual(['Shopify ships this natively within two releases']);
    expect(review.adjustments).toEqual([{ axis: 'moat', delta: -6, reason: 'no defensibility named' }]);
    expect(review.rawHold).toBe(75); // the proposer's untouched number stays in the trail
    expect(review.capsApplied).toEqual([]);
  });

  it('critic unavailable → every proposal lands unverified (watch/40)', async () => {
    const db = useTestDb();
    seedSignal(db);
    const d = { ...draft('unverified-one'), window: '12-18 months' };
    vi.mocked(chatJSON).mockResolvedValueOnce({ opportunities: [d] } as never);
    // second call hits the base mock: { reviews: [] }

    await runOpportunities();
    const row = db.select().from(opportunities).where(eq(opportunities.slug, 'unverified-one')).get()!;
    expect(row.verdict).toBe('watch');
    expect(row.confidence).toBe(40);
    expect(JSON.parse(row.review!).criticUnavailable).toBe(true);
  });

  it('does not steal or archive a private row that shares a public slug', async () => {
    const db = useTestDb();
    seedSignal(db);
    const now = new Date();
    const old = new Date(Date.now() - 30 * 864e5);
    db.insert(opportunities)
      .values({
        slug: 'canonical',
        ownerUserId: null,
        title: 'Public canonical',
        thesis: 'Public canonical thesis that is long enough to pass checks.',
        status: 'active',
        flipScore: 50,
        holdScore: 50,
        scores: '{}',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();
    const privateRow = db
      .insert(opportunities)
      .values({
        slug: 'canonical',
        ownerUserId: 1,
        title: 'Private canonical',
        thesis: 'PRIVATE distinctive thesis that must survive the daily job.',
        status: 'active',
        flipScore: 40,
        holdScore: 40,
        scores: '{}',
        firstSeenAt: old,
        lastSeenAt: old,
      })
      .returning()
      .get()!;

    vi.mocked(chatJSON).mockResolvedValueOnce({ opportunities: [draft('canonical')] } as never);
    const res = await runOpportunities();
    expect(res.archived).toBe(0);

    const prompt = String(vi.mocked(chatJSON).mock.calls[0]?.[1] ?? '');
    expect(prompt).not.toContain('PRIVATE distinctive thesis');

    const pub = db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.slug, 'canonical'), isNull(opportunities.ownerUserId)))
      .get()!;
    expect(pub.id).not.toBe(privateRow.id);
    expect(pub.title).toBe('Bulk background removal for Shopify sellers');

    const priv = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).get()!;
    expect(priv.id).toBe(privateRow.id);
    expect(priv.thesis).toBe('PRIVATE distinctive thesis that must survive the daily job.');
    expect(priv.status).toBe('active');
  });
});

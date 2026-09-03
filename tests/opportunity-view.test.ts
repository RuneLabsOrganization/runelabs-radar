import { beforeEach, describe, expect, it } from 'vitest';
import { oppViewFromRow } from '@/lib/opportunities/view';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { opportunities, stories } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

type OppRow = typeof opportunities.$inferSelect;

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function row(overrides: Partial<OppRow> = {}): OppRow {
  const now = new Date();
  return {
    id: 1,
    slug: 'test-opening',
    ownerUserId: null,
    title: 'Test opening',
    thesis: 'A sufficiently long thesis for the view model to carry.',
    sector: 'devtools',
    status: 'active',
    flipScore: 72,
    holdScore: 55,
    scores: JSON.stringify(Object.fromEntries(SUB_KEYS.map((k) => [k, 12]))),
    kpis: null,
    evidence: '[]',
    window: '6-9 months',
    windowMonths: 8,
    verdict: 'pursue',
    confidence: 60,
    review: null,
    reviewedAt: now,
    brief: null,
    briefGeneratedAt: null,
    plan: null,
    planGeneratedAt: null,
    planRuns: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

const VALID_BRIEF = {
  icp: 'E-commerce operators with large catalogs who pay per-image editors',
  mvp: ['upload API', 'background removal worker', 'credit billing'],
  stackVenture: null,
  stackNotes: null,
  unitEconomics: {
    assumptions: ['image models at $0.002/image'],
    monthlyCostUsd: 40,
    suggestedPriceUsd: 29,
    breakEvenCustomers: 2,
  },
  gtm: ['shopify app store'],
  risks: ['platform dependency'],
};

describe('oppViewFromRow — current shape', () => {
  it('maps a fully-populated row onto the dossier view model', () => {
    const view = oppViewFromRow(
      row({
        scores: JSON.stringify({ ...Object.fromEntries(SUB_KEYS.map((k) => [k, 12])), demand: 16 }),
        kpis: JSON.stringify({
          initialCostUsd: 250.456,
          monthlyCostUsd: 40,
          priceUsd: -5, // negative → null
          timeToMvpDays: 400, // over the 365 cap → null
          breakEvenCustomers: 2,
          competitorCount: 3,
          competitionNote: 'crowded at the low end',
          regulatoryNote: null,
        }),
        review: JSON.stringify({
          killRisks: ['incumbent ships it', 'platform absorbs it'],
          flags: ['forged'],
          capsApplied: [
            { play: 'flip', rule: 'evidence < 2', from: 80, to: 40 },
            { play: 'hold', rule: 'confidence cap', from: 70, to: 30 },
          ],
          criticUnavailable: true,
        }),
        evidence: JSON.stringify([{ type: 'entity', label: 'MiniMax H3 (6 mentions)' }]),
        brief: JSON.stringify(VALID_BRIEF),
      }),
    );

    expect(view.id).toBe(1);
    expect(view.verdict).toBe('pursue');
    expect(view.confidence).toBe(60);
    // 10-axis scores (moat present) → not legacy; values pass through
    expect(view.legacy).toBe(false);
    expect(view.sub.demand).toBe(16);
    expect(view.sub.moat).toBe(12);

    // kpis sanitized: rounded, out-of-range and negative numbers nulled
    expect(view.kpis).toEqual({
      initialCostUsd: 250.46,
      monthlyCostUsd: 40,
      priceUsd: null,
      timeToMvpDays: null,
      breakEvenCustomers: 2,
      competitorCount: 3,
      competitionNote: 'crowded at the low end',
      regulatoryNote: null,
    });

    // review trail reduced to what the dossier renders
    expect(view.review).toEqual({
      killRisks: ['incumbent ships it', 'platform absorbs it'],
      flags: ['forged'],
      capsApplied: [
        { play: 'flip', rule: 'evidence < 2', from: 80, to: 40 },
        { play: 'hold', rule: 'confidence cap', from: 70, to: 30 },
      ],
      criticUnavailable: true,
    });

    // entity evidence enriched with its watch-page href
    expect(view.evidence).toEqual([{ type: 'entity', label: 'MiniMax H3 (6 mentions)', href: '/entity/minimax-h3' }]);

    // brief parsed with its market numbers
    expect(view.brief?.icp).toBe(VALID_BRIEF.icp);
    expect(view.brief?.unitEconomics).toEqual({
      assumptions: ['image models at $0.002/image'],
      monthlyCostUsd: 40,
      suggestedPriceUsd: 29,
      breakEvenCustomers: 2,
    });

    expect(view.isNew).toBe(true);
    expect(view.firstSeenLabel).toBe('just now');
  });
});

describe('oppViewFromRow — legacy shape', () => {
  it('flags rows whose scores predate the 10-axis assessment', () => {
    const view = oppViewFromRow(row({ scores: JSON.stringify({ demand: 16, buildability: 15 }) }));
    expect(view.legacy).toBe(true); // no numeric moat → pre-dossier row
    expect(view.sub.demand).toBe(16); // present axes still read
    expect(view.sub.moat).toBe(0);
    expect(view.review).toBeNull();
    expect(view.kpis).toBeNull();
    expect(view.brief).toBeNull();
  });
});

describe('oppViewFromRow — corrupt JSON fallbacks', () => {
  it('corrupt scores: zeroed sub-scores and legacy=true', () => {
    const view = oppViewFromRow(row({ scores: '{not-json' }));
    expect(view.legacy).toBe(true);
    for (const k of SUB_KEYS) expect(view.sub[k]).toBe(0);
  });

  it('corrupt review: review=null', () => {
    expect(oppViewFromRow(row({ review: '{oops' })).review).toBeNull();
  });

  it('corrupt kpis: kpis=null', () => {
    expect(oppViewFromRow(row({ kpis: 'not json' })).kpis).toBeNull();
  });

  it('corrupt brief: brief=null', () => {
    expect(oppViewFromRow(row({ brief: '[1,2' })).brief).toBeNull();
  });

  it('corrupt or non-array evidence: evidence=[]', () => {
    expect(oppViewFromRow(row({ evidence: 'not-json' })).evidence).toEqual([]);
    expect(oppViewFromRow(row({ evidence: '{"type":"pain"}' })).evidence).toEqual([]);
    // entries without a string label are dropped, valid ones survive
    const view = oppViewFromRow(
      row({ evidence: JSON.stringify([{ type: 'pain', label: 'real pain' }, { type: 'pain' }, 'junk']) }),
    );
    expect(view.evidence).toEqual([{ type: 'pain', label: 'real pain', href: null }]);
  });
});

describe('oppViewFromRow — review shape tolerance', () => {
  it('drops malformed capsApplied entries and coerces unknown plays to hold', () => {
    const view = oppViewFromRow(
      row({
        review: JSON.stringify({
          killRisks: ['one', 2, 'two', 'three', 'four'], // capped at 3, strings only
          flags: 'not-an-array',
          capsApplied: [
            { play: 'flip', rule: 'ok', from: 80, to: 40 },
            { play: 'wildcard', rule: 'unknown play coerces', from: 70, to: 30 },
            { play: 'flip', rule: 'missing numbers' },
            'garbage',
          ],
        }),
      }),
    );
    expect(view.review).toEqual({
      killRisks: ['one', 'two', 'three'],
      flags: [],
      capsApplied: [
        { play: 'flip', rule: 'ok', from: 80, to: 40 },
        { play: 'hold', rule: 'unknown play coerces', from: 70, to: 30 },
      ],
      criticUnavailable: false,
    });
  });
});

describe('oppViewFromRow — brief shapes', () => {
  it('a brief failing validation reads as null, not as a half-rendered card', () => {
    const invalid = { ...VALID_BRIEF, icp: 'short' }; // icp < 15 chars
    expect(oppViewFromRow(row({ brief: JSON.stringify(invalid) })).brief).toBeNull();
  });

  it('a brief without market data keeps the copy and nulls the numbers', () => {
    const noMarket = { ...VALID_BRIEF, unitEconomics: {} };
    const view = oppViewFromRow(row({ brief: JSON.stringify(noMarket) }));
    expect(view.brief?.icp).toBe(VALID_BRIEF.icp);
    expect(view.brief?.unitEconomics).toEqual({
      assumptions: [],
      monthlyCostUsd: null,
      suggestedPriceUsd: null,
      breakEvenCustomers: null,
    });
  });
});

describe('oppViewFromRow — story evidence and freshness', () => {
  it('links story evidence to the latest curated story with that title prefix', () => {
    const storyId = db
      .insert(stories)
      .values({ title: 'Acme ships a cross-vendor spend tracker', tldr: 't', status: 'curated', topScore: 80, createdAt: new Date() })
      .returning({ id: stories.id })
      .get()!.id;

    const view = oppViewFromRow(
      row({
        evidence: JSON.stringify([
          { type: 'story', label: 'Acme ships a cross-vendor spend' },
          { type: 'story', label: 'tiny' }, // < 8 chars → never linked
          { type: 'story', label: 'No such story exists anywhere' },
        ]),
      }),
    );
    expect(view.evidence[0]).toEqual({ type: 'story', label: 'Acme ships a cross-vendor spend', href: `/story/${storyId}` });
    expect(view.evidence[1]!.href).toBeNull();
    expect(view.evidence[2]!.href).toBeNull();
  });

  it('isNew only within the first 24h; firstSeenLabel ages with the row', () => {
    const old = new Date(Date.now() - 3 * 864e5);
    const view = oppViewFromRow(row({ firstSeenAt: old }));
    expect(view.isNew).toBe(false);
    expect(view.firstSeenLabel).toBe('3d ago');
  });
});

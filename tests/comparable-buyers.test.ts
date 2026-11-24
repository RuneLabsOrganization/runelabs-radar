import { describe, expect, it } from 'vitest';
import { comparableBuyers } from '@/lib/opportunities/comparable-buyers';
import { parseCommercial, type CommercialProfile } from '@/lib/opportunities/commercial';

const cases = [
  { name: 'Optmyzr', url: 'https://www.optmyzr.com/', industry: 'Digital advertising agencies', payer: 'Agency owner (PPC or local-services agency)',
    counts: {low: 1, base: 10, high: 15}, denominator: '50 US companies' },
  { name: 'Elevar', url: 'https://apps.shopify.com/gtm-datalayer-by-elevar', industry: 'E-commerce retail (Shopify merchants advertising on Google Ads)',
    payer: 'Shopify merchant', counts: {low: 6, base: 54, high: 445}, denominator: '4,009 US Shopify stores' },
  { name: 'Voluum', url: 'https://voluum.com/', industry: 'Affiliate marketing', payer: 'Affiliate marketer or small media-buying team',
    counts: {low: 1, base: 8, high: 11}, denominator: '28 US companies' },
];

function profile(c: typeof cases[number]): CommercialProfile {
  return {
    geography: 'United States', businessModel: 'B2B', industry: c.industry, payer: c.payer,
    researchedAt: '2026-11-24T00:00:00.000Z',
    competition: [{name: c.name, offering: 'Tracking and reporting', sourceIds: ['V3']}],
    sources: [{id: 'V3', title: c.name, url: c.url, snippet: 'Public product information.', publishedAt: null}],
  };
}

describe('comparable-based reachable buyer pools', () => {
  it.each(cases)('calculates the $name scenarios and returns a self-contained market with display-safe assumptions', c => {
    const p = profile(c);
    const result = comparableBuyers(p)!;
    expect(result.market.buyerCounts).toEqual(c.counts);
    expect(result.market.assumptions).toContain('12 months');
    expect(result.market.assumptions).toContain('5/15/40 records/week × 48 weeks');
    expect(result.market.assumptions).toContain('licensed');
    expect(result.market.assumptions).toContain('outside the list');
    expect(result.market.assumptions.length).toBeLessThanOrEqual(600);
    expect(result.sources.some(s => s.snippet.includes(c.denominator))).toBe(true);
    const ids = result.sources.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^B\d+$/.test(id))).toBe(true);
    expect(result.market.sourceIds).toEqual(ids);
    expect(result.sources.find(s => s.url === c.url)).toMatchObject({title: c.name, snippet: 'Public product information.'});
    expect(p.sources[0].id).toBe('V3');
    expect(parseCommercial({...p, competition: undefined, sources: result.sources, market: result.market})).not.toBeNull();
  });

  it('requires a US payer and cited comparable in the appropriate market', () => {
    const p = profile(cases[1]);
    for (const patch of [{geography: 'Canada'}, {payer: 'Advertising agency'}, {competition: []},
      {sources: [{...p.sources[0], url: 'https://unrelated.org/elevar'}]}]) {
      expect(comparableBuyers({...p, ...patch})).toBeUndefined();
    }
  });
});

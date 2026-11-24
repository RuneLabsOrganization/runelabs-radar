import { describe, expect, it } from 'vitest';
import { comparableChannels } from '@/lib/opportunities/channel-cac';
import { type CommercialProfile } from '@/lib/opportunities/commercial';

const cohorts = {
  optmyzr: { name: 'Optmyzr', url: 'https://www.optmyzr.com/', payer: 'PPC agencies', industry: 'Paid search' },
  elevar: { name: 'Elevar', url: 'https://apps.shopify.com/gtm-datalayer-by-elevar', payer: 'Shopify merchant', industry: 'E-commerce analytics' },
  voluum: { name: 'Voluum', url: 'https://voluum.com/', payer: 'Affiliate media buyers', industry: 'Affiliate attribution' },
};
function profile(product: keyof typeof cohorts): CommercialProfile {
  const { name, url, payer, industry } = cohorts[product];
  return {
    geography: 'United States', businessModel: 'B2B', payer, industry, researchedAt: '2026-11-24T00:00:00.000Z',
    sources: [{ id: 'V1', url, title: name, snippet: name + ' product for ' + payer, publishedAt: null }],
    competition: [{ name, offering: name + ' product for ' + payer, sourceIds: ['V1'] }],
  };
}

describe('comparable US acquisition channels', () => {
  it('recommends search for the PPC agency launch even when referrals are cheaper', () => {
    const { channels } = comparableChannels(profile('optmyzr'), 100)!;
    expect(channels.map(c => c.channel)).toEqual(['US paid search', 'PPC agency customer referrals']);
    expect(channels[0].usd).toEqual({ low: 904.98, base: 1720.26, high: 3350.81 });
    // Low CAC: $10/month for 3 months plus one hour across intros and onboarding.
    expect(channels[1].usd).toEqual({ low: 89.80, base: 179.70, high: 419.40 });
    expect(channels[1].usd.base).toBeLessThan(channels[0].usd.base);
  });

  it.each(['optmyzr', 'elevar', 'voluum'] as const)('anchors only paid search to the six-month trial funnel for %s', key => {
    const { channels, sources } = comparableChannels(profile(key), 100)!;
    const survey = sources.find(s => s.url === 'https://chartmogul.com/reports/saas-conversion-report/')!;
    const [search] = channels.filter(c => c.sourceIds.includes(survey.id));
    expect(channels.filter(c => c.sourceIds.includes(survey.id))).toHaveLength(1);
    expect(search.channel).toBe('US paid search');
    expect(search.assumptions).toContain('within six months of signup');
    const base = 0.045 * 0.08;
    for (const [scenario, rate] of [['low', base * 2], ['base', base], ['high', base / 2]] as const) {
      expect(search.usd[scenario] - 1.5 * 59.80).toBeCloseTo(5.87 / rate, 2);
    }
  });

  it('models US Shopify ad installs through payment without charging again for the originating clicks', () => {
    const { channels } = comparableChannels(profile('elevar'), 39)!;
    expect(channels.map(c => c.channel)).toEqual([
      'US Shopify App Store search ads', 'US paid search', 'Shopify implementation agency referrals',
    ]);
    expect(channels[0].usd).toEqual({ low: 65.70, base: 259.40, high: 1117.60 });
    expect(channels[0].assumptions).toContain('unknown geography');
    expect(channels[2].usd.base).toBe(124.80);
    expect(channels[2].assumptions).toContain('Elevar terms unknown');
  });

  it('recommends affiliate distribution for tracker buyers and caps the monthly referral fee', () => {
    const { channels } = comparableChannels(profile('voluum'), 2000)!;
    expect(channels.map(c => c.channel)).toEqual(['Affiliate publisher referrals', 'US paid search']);
    expect(channels[0].usd).toEqual({ low: 374.80, base: 1034.70, high: 2699.40 });
    expect(comparableChannels(profile('voluum'), 100)!.channels[0].usd.base).toBe(179.70);
  });

  it.each([null, 0, -1, NaN, Infinity, Number.MAX_VALUE])('retains only price-independent routes for price %s', price => {
    expect(comparableChannels(profile('voluum'), price)?.channels.map(c => c.channel)).toEqual(['US paid search']);
    expect(comparableChannels(profile('elevar'), price)?.channels).toHaveLength(2);
  });

  it('requires a cited competitor with matching geography and buyer', () => {
    const p = profile('elevar');
    for (const changes of [{ geography: 'Canada' }, { competition: [] }, { payer: 'Dentists' }, { sources: [] },
      { sources: [{ ...p.sources[0], url: 'https://apps.shopify.com/some-other-app' }] }]) {
      expect(comparableChannels({ ...p, ...changes }, 39)).toBeUndefined();
    }
  });

  it('returns distinct channels and exactly the referenced, reusable C-series sources', () => {
    for (const key of ['optmyzr', 'elevar', 'voluum'] as const) {
      const p = profile(key);
      const { channels, sources } = comparableChannels(p, 39)!;
      const ids = sources.map(s => s.id);
      expect(new Set(channels.map(c => c.channel)).size).toBe(channels.length);
      expect(new Set(ids)).toEqual(new Set(channels.flatMap(c => c.sourceIds)));
      expect(new Set(ids).size).toBe(sources.length);
      expect(new Set(sources.map(s => s.url)).size).toBe(sources.length);
      expect(ids.every(id => /^C\d+$/.test(id))).toBe(true);
      for (const c of channels) {
        expect(c.usd.low).toBeGreaterThan(0);
        expect(c.usd.low).toBeLessThan(c.usd.base);
        expect(c.usd.base).toBeLessThan(c.usd.high);
        expect(c.assumptions.length).toBeLessThanOrEqual(600);
        expect(c.assumptions).toContain('$59.80');
      }
      // A caller can remap its returned sources without changing the catalog.
      sources[0].id = 'REMAPPED';
      expect(comparableChannels(p, 39)!.sources[0].id).toBe(ids[0]);
    }
  });
});

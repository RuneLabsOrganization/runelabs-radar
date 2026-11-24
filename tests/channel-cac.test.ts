import { describe, expect, it } from 'vitest';
import { comparableChannels, founderPilotPayers } from '@/lib/opportunities/channel-cac';
import { bootstrapAssessment } from '@/lib/opportunities/bootstrap';
import { parseCommercial, type CommercialProfile } from '@/lib/opportunities/commercial';

const cohorts = {
  optmyzr: { name: 'Optmyzr', url: 'https://www.optmyzr.com/', payer: 'PPC agencies', industry: 'Paid search' },
  elevar: { name: 'Elevar', url: 'https://apps.shopify.com/gtm-datalayer-by-elevar', payer: 'Shopify merchant', industry: 'E-commerce analytics' },
  voluum: { name: 'Voluum', url: 'https://voluum.com/', payer: 'Affiliate media buyers', industry: 'Affiliate attribution' },
};
const founderChannels = ['US organic inbound', 'US founder-led outbound'];
function profile(product: keyof typeof cohorts): CommercialProfile {
  const { name, url, payer, industry } = cohorts[product];
  return {
    geography: 'United States', businessModel: 'B2B', payer, industry, researchedAt: '2026-11-24T00:00:00.000Z',
    sources: [{ id: 'V1', url, title: name, snippet: name + ' product for ' + payer, publishedAt: null }],
    competition: [{ name, offering: name + ' product for ' + payer, sourceIds: ['V1'] }],
  };
}

describe('comparable US acquisition channels', () => {
  it.each([
    ['optmyzr', 'spreadsheet alert audit', 'PPC export'],
    ['elevar', 'tracking checklist', 'event log'],
    ['voluum', 'click-to-sale diagnosis', 'click and sales exports'],
  ] as const)('attaches a zero-cash solo pilot only to the cited %s dossier', (product, offer, input) => {
    const p = profile(product);
    const { channels, sources } = comparableChannels(p, 100)!;
    const localId = (id: string) => id.replace('C', 'S');
    p.sources.push(...sources.map(s => ({ ...s, id: localId(s.id) })));
    p.cacChannels = channels.map(c => ({ ...c, sourceIds: c.sourceIds.map(localId) }));
    const costs = { initialCostUsd: 200, monthlyCostUsd: 50, timeToMvpDays: 30 };
    const assess = (changes: Partial<CommercialProfile>) => bootstrapAssessment(costs, { ...p, ...changes });
    const { soloPilot, points } = assess({});
    expect(soloPilot).toMatchObject({ days: 90, acquisitionCashUsd: 0, sourceIds: ['S10', 'S2', 'S11'] });
    const stored = parseCommercial({ ...p, cac: { ...p.cacChannels[0], kind: 'scenario' }, bootstrap: assess({}) });
    expect(stored?.bootstrap?.soloPilot).toEqual(soloPilot);
    const payers = founderPilotPayers();
    expect(soloPilot!.expectedPayers).toBeCloseTo(payers.organic.base + payers.outbound.base, 14);
    expect(soloPilot!.founderHours).toBeCloseTo(20.5 + 24.765 + 2 + 300 / 60, 12);
    for (const phrase of [offer, input, 'Before building', 'delivered manually', '2 ', 'email 300', 'voluntary unpaid',
      'extra minute/address', 'free methods preserve base exposure and conversion', 'Sales may be zero']) {
      expect(soloPilot!.assumptions).toContain(phrase);
    }
    expect(soloPilot!.assumptions.length).toBeLessThanOrEqual(600);
    for (const changes of [{ geography: 'Canada' }, { competition: [] }, { cacChannels: undefined },
      { cacChannels: p.cacChannels.slice(0, -1) }, { sources: p.sources.filter(s => s.id !== 'S11') },
      { cacChannels: p.cacChannels.map(c => ({ ...c, sourceIds: ['S2', 'V1'] })) }]) {
      const result = assess(changes);
      expect(result).not.toHaveProperty('soloPilot');
      expect(result.points).toBe(points);
    }
  });

  it('exports the unrounded 90-day pilot denominators used for CAC', () => {
    const payers = founderPilotPayers();
    const [organic, outbound] = comparableChannels(profile('optmyzr'), null)!.channels.slice(-2);
    for (const [scenario, cost, inboundCount, outboundCount, incentives, verification] of [
      ['favorable', 'low', 0.32, 0.306, 0, 0],
      ['base', 'base', 0.16, 0.153, 30, 15],
      ['adverse', 'high', 0.08, 0.0765, 60, 30],
    ] as const) {
      expect(payers.organic[scenario]).toBeCloseTo(inboundCount, 14);
      expect(payers.outbound[scenario]).toBeCloseTo(outboundCount, 14);
      expect(organic.cashUsd[cost]).toBe(Math.round(100 * incentives / payers.organic[scenario]) / 100);
      expect(outbound.cashUsd[cost]).toBe(Math.round(100 * verification / payers.outbound[scenario]) / 100);
    }
  });

  it('recommends search for the PPC agency launch even when referrals are cheaper', () => {
    const { channels } = comparableChannels(profile('optmyzr'), 100)!;
    expect(channels.map(c => c.channel)).toEqual(['US paid search', 'PPC agency customer referrals', ...founderChannels]);
    expect(channels[0].usd).toEqual({ low: 904.98, base: 1720.26, high: 3350.81 });
    // Low CAC: $10/month for 3 months plus one hour across intros and onboarding.
    expect(channels[1].usd).toEqual({ low: 89.80, base: 179.70, high: 419.40 });
    expect(channels[1].cashUsd).toEqual({ low: 10, base: 10, high: 10 });
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
      expect(search.cashUsd[scenario]).toBeCloseTo(5.87 / rate, 2);
    }
  });

  it('models US Shopify ad installs through payment without charging again for the originating clicks', () => {
    const { channels } = comparableChannels(profile('elevar'), 39)!;
    expect(channels.map(c => c.channel)).toEqual([
      'US Shopify App Store search ads', 'US paid search', 'Shopify implementation agency referrals', ...founderChannels,
    ]);
    expect(channels[0].usd).toEqual({ low: 65.70, base: 259.40, high: 1117.60 });
    expect(channels[0].cashUsd).toEqual({ low: 35.80, base: 199.60, high: 998 });
    expect(channels[0].assumptions).toContain('unknown geography');
    expect(channels[2].usd.base).toBe(124.80);
    expect(channels[2].assumptions).toContain('Elevar terms unknown');
  });

  it('recommends affiliate distribution for tracker buyers and caps the monthly referral fee', () => {
    const { channels } = comparableChannels(profile('voluum'), 2000)!;
    expect(channels.map(c => c.channel)).toEqual(['Affiliate publisher referrals', 'US paid search', ...founderChannels]);
    expect(channels[0].usd).toEqual({ low: 374.80, base: 1034.70, high: 2699.40 });
    expect(channels[0].cashUsd).toEqual({ low: 105, base: 105, high: 105 });
    expect(comparableChannels(profile('voluum'), 100)!.channels[0].usd.base).toBe(179.70);
  });

  it.each([null, 0, -1, NaN, Infinity, Number.MAX_VALUE])('retains only price-independent routes for price %s', price => {
    expect(comparableChannels(profile('voluum'), price)?.channels.map(c => c.channel)).toEqual(['US paid search', ...founderChannels]);
    expect(comparableChannels(profile('elevar'), price)?.channels).toHaveLength(4);
  });

  it.each([
    ['optmyzr', 'PPC account audit', 'PPC agency owners'],
    ['elevar', 'Shopify event tracking', 'Shopify merchants'],
    ['voluum', 'affiliate postback tracking', 'affiliate media buyers'],
  ] as const)('allocates founder startup work and incremental campaign cash for %s', (product, guide, audience) => {
    const { channels, sources } = comparableChannels(profile(product), null)!;
    const [organic, outbound] = channels.slice(-2);
    expect(organic.assumptions).toContain(guide);
    expect(organic.assumptions).toContain('First 90 days');
    expect(organic.assumptions).toContain('first ten may take longer');
    if (product === 'elevar') expect(organic.assumptions).toContain('Exclude direct App Store discovery');
    expect(outbound.assumptions).toContain(audience);
    expect(outbound.assumptions).toContain('Exclude warm introductions');
    for (const [channel, domain] of [[organic, 'nuoptima.com'], [outbound, 'belkins.io']] as const) {
      const domains = sources.filter(s => channel.sourceIds.includes(s.id)).map(s => new URL(s.url).hostname);
      expect(domains).toEqual(expect.arrayContaining([domain, 'www.bls.gov']));
    }
    for (const [scenario, leads, incentives, closeRate, verification] of [
      ['low', 6, 0, 0.20, 0], ['base', 3, 30, 0.10, 15], ['high', 1.5, 60, 0.05, 30],
    ] as const) {
      const inboundPayers = leads * 8 / 75 * 0.5;
      expect(organic.cashUsd[scenario]).toBe(Math.round(100 * incentives / inboundPayers) / 100);
      expect(organic.usd[scenario]).toBeCloseTo((incentives + (19 + leads / 2) * 59.80) / inboundPayers, 2);
      const replies = 300 * 0.0051;
      const outboundPayers = replies * closeRate;
      expect(outbound.cashUsd[scenario]).toBeCloseTo(verification / outboundPayers, 2);
      expect(outbound.usd[scenario]).toBeCloseTo((verification + (24 + replies / 2) * 59.80) / outboundPayers, 2);
    }
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

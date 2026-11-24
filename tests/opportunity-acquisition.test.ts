import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CommercialResearch from '@/components/CommercialResearch';
import { acquisitionSources } from '@/lib/opportunities/acquisition-sources';
import { parseCommercial, type CommercialSource } from '@/lib/opportunities/commercial';
import { sanitizeKpis, sanitizeOpportunities, SUB_KEYS, type OppDraft } from '@/lib/opportunities/engine';
import { buildCommercial } from '@/lib/opportunities/research-findings';

const now = '2026-11-24T12:00:00.000Z';
const target = {
  businessModel: 'B2B' as const, sellerCategory: 'B2B marketing software', payer: 'Small marketing agencies',
  industry: 'Advertising', user: 'Agency marketers', task: 'Measure campaign results',
};
function draft(overrides: Partial<NonNullable<OppDraft['researchTarget']>> = {}) {
  return sanitizeOpportunities([{slug: 'campaigns', title: 'Campaign reporting', thesis: 'Reporting across clients is slow.',
    subScores: Object.fromEntries(SUB_KEYS.map(k => [k, 12])), researchTarget: {...target, ...overrides}}], new Set(), undefined, 1, true)[0]!;
}
const compute = (sources: CommercialSource[], claims = {}, geo = 'United States') =>
  buildCommercial({...target, ...claims}, sources, geo, now);
const conversion = { low: 0.01, base: 0.025, high: 0.05 };
const scenario = { kind: 'scenario', sourceId: 'A1', conversion, assumptions: 'Pilot sensitivity to clicks that become paying contracts.' };
const observed = { kind: 'observed', sourceId: 'A1', assumptions: 'Comparable seller, buyer and channel.' };

const merchantAudience = { businessModel: 'B2B', payer: 'Shopify merchant', user: 'Shopify store owner or freelance media buyer',
  industry: 'E-commerce advertising and analytics' } as const;
const monitoringBasis = { kind: 'direct', usdPerEvent: 39, eventsPerPayerMonth: 0.8, payer: 'Shopify merchant',
  assumptions: '$39/month monitoring plan; some customers churn after the one-time fix, so a blended average is assumed.' };
const merchantOpportunity = {
  title: 'Shopify Google Gateway and conversion-tracking setup doctor with a fix-it checklist',
  thesis: 'Simplifying Google Gateway setup and conversion tracking for Shopify stores shows up 5x as a pain, so merchants and freelancers are stuck on it. A scanner can check tags, consent mode, enhanced conversions and event deduplication, then generate store-specific fix steps. Model cost is negligible, and the sale can be a one-off audit or a monitoring subscription.',
  kpis: sanitizeKpis({ audience: merchantAudience, priceBasis: monitoringBasis }),
};

describe('SaaS comparators from stored opportunities', () => {
  it('recovers only the external paid SaaS cohort from a merchant diagnostic and recurring monitoring plan', async () => {
    for (const opportunity of [merchantOpportunity, { ...merchantOpportunity,
      researchTarget: { ...merchantAudience, task: 'Diagnose tracking', sellerCategory: 'Conversion tracking' } }]) {
      const sources = await acquisitionSources(opportunity, 'United States');
      expect(sources).toHaveLength(1);
      const profile = compute(sources, { ...merchantAudience, cac: observed });
      expect(profile?.cacReferences).toMatchObject([{publisher:'First Page Sage', unit:'paying customer', usd:357, scope:'external'}]);
      expect(profile?.cac).toBeUndefined();
    }
  });

  it('uses a software product described in the thesis when its purchasers are agencies', async () => {
    const sources = await acquisitionSources({ title: 'Campaign reconciliation', thesis: 'A self-serve web app for media agencies.',
      kpis: sanitizeKpis({ audience: { ...merchantAudience, payer: 'Media agencies' },
        priceBasis: { ...monitoringBasis, payer: 'Media agencies', assumptions: 'Agencies buy an annual subscription.' } }) }, 'Canada');
    expect(sources.map(s => s.title)).toEqual([expect.stringContaining('B2B SaaS')]);
  });

  it('does not infer SaaS from recurring services, dependency on software, or billing frequency alone', async () => {
    const manual = { ...merchantOpportunity, title: 'Managed conversion tracking service', thesis: 'Our agency uses a web app to audit each account.' };
    const noProduct = { ...merchantOpportunity, title: 'Merchant reporting checklist', thesis: 'A checklist for store owners.' };
    const noSubscription = sanitizeKpis({ audience: merchantAudience, priceBasis: { ...monitoringBasis,
      assumptions: 'One setup fee per customer, averaged over a month.' } });
    const manualAudit = { ...merchantOpportunity, title: 'Monthly tracking review for merchants',
      thesis: 'An analyst uses a scanner to prepare a manual report for each customer.' };
    for (const opportunity of [manual, manualAudit, noProduct, { ...merchantOpportunity, kpis: noSubscription },
      { ...merchantOpportunity, kpis: sanitizeKpis({ audience: merchantAudience, priceUsd:39 }) },
      { ...merchantOpportunity, researchTarget: { ...merchantAudience, task:'Review accounts', sellerCategory:'Marketing agency services' } }]) {
      expect((await acquisitionSources(opportunity, 'US')).some(s => s.title.includes('First Page Sage'))).toBe(false);
    }
  });
});

describe('verified acquisition benchmarks', () => {
  it('preserves dated industry CPC and provider CAC with separate denominators and geography', async () => {
    const sources = await acquisitionSources(draft({payer: 'Small businesses and marketing agencies'}), 'USA');
    expect(sources.map(s => s.id)).toEqual(['A1', 'A2', 'A3', 'A4']);
    const profile = compute(sources)!;
    expect(profile.cacReferences).toMatchObject([
      {publisher: 'LocaliQ / WordStream', unit: 'click', usd: 5.87, geography: 'United States'},
      {publisher: 'Constant Contact', unit: 'paying customer', usd: 304, period: 'FY 2008'},
      {publisher: 'Banzai', unit: 'paying customer', usd: 1519, period: 'FY 2024'},
      {publisher: 'First Page Sage', unit: 'paying customer', usd: 357, scope: 'external'},
    ]);
    expect(profile.cac).toBeUndefined();
    expect(parseCommercial(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    const html = renderToStaticMarkup(createElement(CommercialResearch, {profile}));
    for (const value of ['Paid-channel benchmark', 'External paying-customer CAC benchmark', 'no geographic breakdown',
      '13,474', 'Customer acquisition cost unknown.', sources[0].url]) expect(html).toContain(value);
  });

  it('derives media-only CAC exclusively from verified CPC and ordered payer conversions', async () => {
    const sources = await acquisitionSources(draft(), 'United States');
    const profile = compute(sources, {cac: {...scenario, costPerContactUsd: 2500}})!;
    expect(profile.cac).toMatchObject({kind: 'scenario', usd: {low: 117.4, base: 234.8, high: 587}});
    for (const cac of [observed, {...scenario, assumptions:'Measured fraction of clicks becoming leads.'},
      {...scenario, sourceId:'A99'}, {...scenario, conversion:{...conversion, high:0}},
      {...scenario, conversion:{...conversion, base:0.005}}, {...scenario, conversion:{...conversion, low:1e-200}}]) {
      expect(compute(sources, {cac})?.cac).toBeUndefined();
    }
    expect(compute([{...sources[0], snippet: sources[0].snippet.replace('5.87', '0.05')}], {cac: scenario})).toBeNull();
  });

  it('round-trips four catalog entries alongside an independent S-series benchmark', async () => {
    const sources = await acquisitionSources(draft({payer:'Small businesses and marketing agencies'}), 'US');
    const q = 'Advertising agencies in the United States recorded USD 18 per lead from paid search in 2025.';
    const s = {id:'S1',url:'https://ads.example.org/study',title:'Agency search study',snippet:q,publishedAt:now};
    const acquisitionBenchmark = {sourceId:s.id,quote:q,period:'2025',cohort:'Advertising agencies',channel:'paid search',unit:'lead'};
    const profile = compute([...sources, s], {acquisitionBenchmark});
    expect(profile?.cacReferences).toHaveLength(5);
    expect(parseCommercial(JSON.parse(JSON.stringify(profile)))?.sources).toHaveLength(5);
  });

  it('keeps nonlocal comparators out of CAC estimates and does not use a buyer’s industry as the selling category', async () => {
    const sources = await acquisitionSources(draft(), 'Canada');
    expect(sources.length).toBeGreaterThan(0);
    expect(compute(sources, {}, 'Canada')?.cacReferences?.every(r => r.scope === 'external')).toBe(true);
    for (const cac of [observed, scenario]) expect(compute(sources, {cac}, 'Canada')?.cac).toBeUndefined();
    const accounting = await acquisitionSources(draft({industry:'Food', sellerCategory:'Restaurant accounting software', payer:'Restaurant owners'}), 'US');
    expect(accounting.map(s => s.title)).toEqual([expect.stringContaining('First Page Sage')]);
    expect(await acquisitionSources(draft({payer:'Unspecified'}), 'US')).toEqual([]);
    expect(await acquisitionSources(draft({sellerCategory:undefined}), 'US')).toEqual([]);
  });

  it('keeps the consumer SaaS paid cohort out of local payback in every geography', async () => {
    const sources = await acquisitionSources(draft({businessModel:'B2C', sellerCategory:'Music software', payer:'Individual consumers'}), 'Brazil');
    const profile = compute(sources, {cac:observed}, 'Brazil')!;
    expect(profile.cacReferences).toMatchObject([{publisher:'First Page Sage', usd:223, scope:'external', geography:'Geography unspecified'}]);
    expect(profile.cac).toBeUndefined();
  });

  it('reports a measured historical per-payer value only for the eligible meal-kit cohort', async () => {
    const meal = draft({businessModel:'B2C', sellerCategory:'Meal-kit delivery', payer:'Households'});
    const sources = await acquisitionSources(meal, 'US');
    const profile = compute(sources, {businessModel:'B2C', payer:'Households', cac:observed})!;
    expect(profile.cac).toMatchObject({kind:'observed', usd:{low:94,base:94,high:94}});
    expect(profile.cacReferences?.[0].methodology).toContain('first paid order');
    expect(renderToStaticMarkup(createElement(CommercialResearch, {profile}))).toContain('own CAC is unknown');
    expect(compute(sources, {cac:scenario})?.cac).toBeUndefined();
    expect(await acquisitionSources(meal, 'New York')).toEqual([]);
    expect(await acquisitionSources(draft({businessModel:'B2C', sellerCategory:'Meal-kit delivery', payer:'Restaurant owners'}), 'US')).toEqual([]);
    expect(parseCommercial({...profile, cac:{...profile.cac, usd:{low:1,base:2,high:3}}})).toBeNull();
  });
});

const publisher = 'https://ads.example.org/annual-report';
const quote = 'Photography ads in Canada had a 2025 search benchmark of USD 25 per lead.';
function fromSearch(q: string, changes = {}, sourceChanges = {}, claims = {}) {
  const source = {id:'S3', url:publisher, title:'Publisher campaign study', snippet:q, publishedAt:'2026-05-01T00:00:00.000Z', ...sourceChanges};
  const acquisitionBenchmark = {sourceId:'S3', quote:q, cohort:'Photography', channel:'search', period:'2025', unit:'lead', ...changes};
  return compute([source], {industry:'Photography', payer:'Photographers', acquisitionBenchmark, ...claims}, 'Canada');
}
describe('retrieved acquisition evidence', () => {
  it('retains CPL on its own or derives a scenario from lead-to-paying conversion', () => {
    expect(fromSearch(quote)?.cacReferences?.[0]).toMatchObject({usd:25,unit:'lead',period:'2025'});
    expect(fromSearch(quote)?.cac).toBeUndefined();
    expect(fromSearch(quote, {}, {}, {cac:{...scenario,sourceId:'S3'}})?.cac).toMatchObject({kind:'scenario',usd:{base:1000}});
    expect(fromSearch(quote, {}, {}, {cac:{...observed,sourceId:'S3'}})?.cac).toBeUndefined();
  });
  it('rejects misleading units, ages, currencies, regions, quotations and audience matches', () => {
    for (const q of [quote.replace('USD', 'CAD $'), quote.replace('Canada','Canada and Mexico'),
      quote.replace('Canada','outside Canada'), quote.replace('25 per lead','25 per trial'),
      quote.replace('USD 25 per lead','USD 25 signup fee and USD 2 per click')]) expect(fromSearch(q)).toBeNull();
    expect(fromSearch(quote, {cohort:'Unrelated'})).toBeNull();
    expect(fromSearch(quote, {quote:quote.slice(1)})).toBeNull();
    expect(fromSearch(quote, {}, {publishedAt:null})).toBeNull();
    expect(fromSearch(quote, {}, {publishedAt:'2027-01-01T00:00:00.000Z'})).toBeNull();
    expect(fromSearch(quote, {}, {url:'https://reddit.com/r/photography'})).toBeNull();
  });
  it('allows grounded per-paying-customer evidence in an issuer filing and rejects other hosts', () => {
    const q = 'Our 2025 marketing spend for Photographers in Canada was USD 80 per new paying customer.';
    const fields = {unit:'paying customer',cohort:'Photographers',channel:'marketing'};
    const claims = {cac:{...observed,sourceId:'S3'}};
    const filing = {url:'https://www.sec.gov/Archives/edgar/data/123/456/report.htm'};
    expect(fromSearch(q, fields, filing, claims)?.cac).toMatchObject({kind:'observed',usd:{low:80,base:80,high:80}});
    expect(fromSearch(q, fields, {}, claims)).toBeNull();
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import type { OppDraft } from '@/lib/opportunities/engine';
import { marketSources } from '@/lib/opportunities/market-sources';
import { fetchWithTimeout } from '@/lib/ingest/adapters/shared';

vi.mock('@/lib/ingest/adapters/shared', () => ({ fetchWithTimeout: vi.fn() }));
const request = vi.mocked(fetchWithTimeout);
afterEach(() => { request.mockReset(); vi.useRealTimers(); });

function draft(payer: string, industry = '', title = ''): OppDraft {
  return { title, thesis: 'Sales via Shopify and Wix.', researchTarget: {
    payer, industry, user: 'Shopify merchants', task: 'Marketing analytics', businessModel: 'other',
  }, kpis: {} } as OppDraft;
}

it('refreshes the localized live store count and preserves the tracker observation date', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-11-30T00:00:00Z'));
  request.mockResolvedValue(new Response(
    '<h1>Shopify Stores in the United States</h1><time datetime="2026-11-27 00:00:00"></time>' +
    '<p>There are 1,329,004 live <a>Shopify</a> stores in the United States.</p>',
  ));
  const [source] = await marketSources(draft('Shopify merchants'), 'U.S.');
  expect(source).toMatchObject({id: 'M1', population: 1_329_004, unit: 'active Shopify stores', period: '2026-11-27',
    publishedAt: '2026-11-27T00:00:00.000Z', url: 'https://storeleads.app/reports/shopify/US/top-stores'});
  expect(source.snippet).toContain('United States');
  expect(source.snippet).toContain('Parent population');
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(['network failure', 'global count', 'wrong-platform count', 'missing date'])('retains the verified dated snapshot on %s', async failure => {
  if (failure === 'network failure') request.mockRejectedValue(new Error('offline'));
  else request.mockResolvedValue(new Response('<h1>Wix Stores in the United States</h1>' +
    (failure === 'missing date' ? '' : '<time datetime="2026-11-20 00:00:00"></time>') +
    '<p>There are 999 live ' + (failure === 'wrong-platform count' ? 'Shopify' : 'Wix') + ' stores ' +
    (failure === 'global count' ? 'worldwide.' : 'in the United States.') + '</p>'));
  const [source] = await marketSources(draft('Wix store owners'), 'USA');
  expect(source).toMatchObject({ population: 276_880, period: '2026-11-20', unit: 'active Wix stores' });
});

it('uses the payer side rather than counting its clients, tools or end users', async () => {
  const sources = await marketSources(draft('Advertising agencies managing Shopify stores', 'digital marketing', 'Shopify reporting'), 'United States');
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({id: 'M1', population: 15_512, period: '2023', publishedAt: '2025-06-26T00:00:00.000Z'});
  expect(sources[0].unit).toContain('establishments');
  expect(sources[0].title).toContain('541810');
  expect(request).not.toHaveBeenCalled();
});

function withPopulation(payer: string, signer: string, population: string, industry: string) {
  const d = draft(payer, industry);
  d.researchTarget!.population = population;
  d.kpis.priceBasis = {kind: 'direct', usdPerEvent: 10, eventsPerPayerMonth: 1, payer: signer, assumptions: 'Monthly billing.'};
  return d;
}

it('uses a countable segment when the price basis describes the signer', async () => {
  const d = withPopulation('Owners of small agencies', 'The managing partner approves the monthly subscription',
    'Advertising agencies', 'Digital advertising');
  expect((await marketSources(d, 'US'))[0]?.population).toBe(15_512);
});

it('uses a named platform in the segment only when a merchant pays', async () => {
  request.mockRejectedValue(new Error('offline'));
  const d = withPopulation('Online merchants', 'The owner pays monthly', 'Shopify stores', 'Retail');
  expect((await marketSources(d, 'US'))[0]?.unit).toBe('active Shopify stores');
  const agency = withPopulation('Online merchants', 'Shopify app agencies managing merchant accounts', 'Shopify stores', 'Retail');
  expect(await marketSources(agency, 'US')).toEqual([]);
  const rival = withPopulation('Wix retailers', 'Wix merchants', 'Shopify stores', 'Retail');
  expect((await marketSources(rival, 'US')).map(s => s.unit)).toEqual(['active Wix stores']);
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not treat an unrelated industry or unspecified payer as corroboration for the proposed segment', async () => {
  const d = withPopulation('Insurance agencies', 'The managing partner pays monthly', 'Advertising agencies', 'Insurance');
  expect(await marketSources(d, 'US')).toEqual([]);
  const unclear = withPopulation('Unspecified', 'The budget owner pays', 'US homeowners', 'Housing');
  expect(await marketSources(unclear, 'US')).toEqual([]);
});

it.each([
  ['janitorial contractors', 67_799, 'establishments'],
  ['building services companies', 227_045, 'establishments'],
  ['HVAC contractors', 111_207, 'establishments'],
  ['marketing consultants', 52_258, 'establishments'],
  ['dental practices', 135_665, 'establishments'],
  ['independent web developers', 87_400, 'jobs'],
  ['freelance web designers', 132_700, 'jobs'],
  ['renters', 46_551_688, 'housing units'],
  ['family caregivers', 63_000_000, 'caregivers'],
] as const)('preserves the published unit for %s', async (payer, population, unit) => {
  const [source] = await marketSources(draft(payer), 'US');
  expect(source.population).toBe(population);
  expect(source.unit).toContain(unit);
  expect(source.snippet).toContain(source.unit);
  expect(source.snippet).toContain(source.period);
  expect(source.snippet).toContain('United States');
  expect(request).not.toHaveBeenCalled();
});

it.each([
  ['Canada', 'Shopify store owners'], ['California', 'professional web designers'], ['United States and Canada', 'advertising agencies'],
  ['United States', 'hospital administrators'], ['US', 'advertisers targeting renters'], ['US', 'insurance agencies'],
  ['US', 'lawyers advising Shopify merchants'], ['US', 'shoppers at Shopify stores'], ['US', 'unspecified'],
])('omits unsupported geography or payer (%s, %s)', async (geo, payer) => {
  expect(await marketSources(draft(payer, 'marketing', 'Wix-powered Shopify advertising agency directory'), geo)).toEqual([]);
  expect(request).not.toHaveBeenCalled();
});

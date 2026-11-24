import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/opportunities/demand-signals', () => ({ addDemandSignals: vi.fn() }));
import { commercialUrl, parseCommercial } from '@/lib/opportunities/commercial';
import { researchFinalists, opportunityGeography } from '@/lib/opportunities/research';
import { chatJSON } from '@/lib/llm/minimax';
import { exaSearch } from '@/lib/search/exa';
import { braveSearch } from '@/lib/search/brave';
import { minimaxSearch } from '@/lib/search/minimax';
import { proposeOpportunities, runOpportunities, sanitizeKpis, sanitizeOpportunities, SUB_KEYS } from '@/lib/opportunities/engine';
import { opportunities, painPoints } from '@/lib/db/schema';
import { MIN_SIGNALS } from '@/lib/opportunities/signals';
import { buildCommercial } from '@/lib/opportunities/research-findings';
import { marketSources } from '@/lib/opportunities/market-sources';
import { useTestDb } from './helpers/db';

vi.mock('@/lib/llm/minimax', () => ({ chatJSON: vi.fn(), drainLlmUsageStats: () => ({}) }));
vi.mock('@/lib/search/exa', () => ({ exaSearch: vi.fn() }));
vi.mock('@/lib/search/brave', () => ({ braveSearch: vi.fn() }));
vi.mock('@/lib/search/minimax', () => ({ minimaxSearch: vi.fn() }));
vi.mock('@/lib/opportunities/market-sources', () => ({ marketSources: vi.fn(async () => []), marketSpendingSource: () => undefined }));
vi.mock('@/lib/opportunities/competitor-sources', () => ({ competitorSources: vi.fn(async () => []) }));
vi.mock('@/lib/opportunities/acquisition-sources', async original => ({
  ...await original<typeof import('@/lib/opportunities/acquisition-sources')>(),
  acquisitionSources: vi.fn(async () => []),
}));
vi.mock('@/lib/opportunities/critic', () => ({ runCritique: vi.fn(async () => new Map()), runDebate: vi.fn() }));

const geography = 'Canada';
const hit = (title: string, url: string, description: string) => ({
  title, url, description, publishedAt: new Date('2025-03-11'),
});
const competitor = hit('FrameLab tools for photographers', 'https://framelab.ca/pricing', 'FrameLab automates photo tagging for subscribers in Canada.');
const census = hit('National photo survey', 'https://www.statcan.gc.ca/photo', 'Canada has 20,000 professional photographers.');
const ads = hit('Photography ads in Canada', 'https://adbench.ca/photo', 'Photography ads in Canada cost USD 2.50 per click.');
const findings = {
  businessModel: 'prosumer', user: 'Photographers', payer: 'Professional photographers', industry: 'Photography',
  competition: [{name: 'FrameLab', offering: 'Automated photo tagging', sourceIds: ['S1']}],
  market: { buyer: 'Professional photographers', sourceId: 'S2', quote: census.description,
    population: 20000, eligibleShare: {low: 0.1, base: 0.2, high: 0.3}, assumptions: 'Working photographers who tag photos manually.' },
  cac: {channel: 'Paid search', sourceId: 'S3', quote: ads.description, costPerContactUsd: 2.5,
    conversion: {low: 0.01, base: 0.025, high: 0.1}, assumptions: 'Paid clicks that convert into subscriptions.'},
  execution: {pilotDays: 8, assumptions: 'Two days to recruit and six to ship a paid tagging pilot.',
    ai: {task: 'Tag from a photo caption', inputTokens: 1000, outputTokens: 100, attemptsPerTask: 1.2, tasksPerCustomerMonth: 40}},
};
const raw = {
  slug: 'photo-tags', title: 'Tagging for photographers', thesis: 'Working photographers spend hours tagging photographs by hand.',
  researchTarget: {businessModel: 'prosumer', industry: 'Photography', user: 'Photographers', payer: 'Professional photographers', task: 'photo tagging'},
  subScores: Object.fromEntries(SUB_KEYS.map(k => [k, 12])), evidenceRefs: [], kpis: {},
};
const draft = () => sanitizeOpportunities([raw], new Set(), undefined, 1, true)[0]!;
const search = vi.mocked(exaSearch);
const synth = vi.mocked(chatJSON);

function fixture() {
  vi.stubEnv('EXA_API_KEY', 'offline');
  vi.stubEnv('BRAVE_API_KEY', '');
  vi.stubEnv('MINIMAX_MODEL', 'MiniMax-M3.1-Flash');
  search.mockResolvedValueOnce([competitor]).mockResolvedValueOnce([census]).mockResolvedValueOnce([ads]);
  synth.mockResolvedValue(findings);
}
beforeEach(() => {
  vi.stubEnv('EXA_API_KEY', '');
  vi.stubEnv('BRAVE_API_KEY', '');
  vi.stubEnv('MINIMAX_API_KEY', '');
});
afterEach(() => { vi.clearAllMocks(); search.mockReset(); synth.mockReset(); vi.unstubAllEnvs(); });

it('enriches a finalist using only its own sources, computes scenario arithmetic and round-trips the stored KPIs', async () => {
  fixture();
  const d = draft();
  await researchFinalists([d], geography);
  expect(search.mock.calls).toHaveLength(3);
  const queries = search.mock.calls.map(([opts]) => opts.query);
  expect(queries.every(q => q.includes(geography) && !q.includes(d.title) && q.split(' ').length <= 12)).toBe(true);
  expect(queries[0]).toContain('photo tagging');
  expect(queries[1]).toContain('Professional photographers');
  expect(queries[2]).toContain('Photography');
  const p = d.kpis.commercial!;
  expect(p).toMatchObject({geography, businessModel: 'prosumer', user: 'Photographers', payer: 'Professional photographers',
    market: {buyerCounts: {low: 2000, base: 4000, high: 6000}}, cac: {usd: {low: 25, base: 100, high: 250}},
    competition: [{name: 'FrameLab', sourceIds: ['S1']}],
    execution: {pilotDays: 8, ai: {model: 'MiniMax-M3.1-Flash', costPerTaskUsd: 0.000252, tasksPerCustomerMonth: 40}}});
  expect(p.sources[1]).toMatchObject({url: census.url, snippet: census.description, publishedAt: '2025-03-11T00:00:00.000Z'});
  expect(sanitizeKpis(JSON.parse(JSON.stringify(d.kpis))).commercial).toEqual(p);
  expect(sanitizeOpportunities([{...raw, kpis: {commercial: p}}], new Set())[0]!.kpis.commercial).toBeUndefined();
  expect(parseCommercial(undefined)).toBeNull();
});

it('requires in-geography numerical evidence and an identifiable competitor from the retrieved page', async () => {
  fixture();
  synth.mockResolvedValue({...findings,
    competition: [{name: 'Invented', offering: 'Imagined competitor', sourceIds: ['S1']}],
    market: {...findings.market, population: 900000}, cac: {...findings.cac, sourceId: 'S99'}});
  const d = draft();
  await researchFinalists([d], 'Brazil');
  expect(d.kpis.commercial?.market).toBeUndefined();
  expect(d.kpis.commercial?.cac).toBeUndefined();
  expect(d.kpis.commercial?.competition).toBeUndefined();
});

it('adds the comparable estimates to a newly researched US agency finalist', async () => {
  vi.stubEnv('EXA_API_KEY', 'offline');
  const offering = 'Monitor multiple Google Ads accounts and optimize PPC campaigns.';
  search.mockResolvedValue([hit('Optmyzr PPC management', 'https://www.optmyzr.com/', offering)]);
  synth.mockResolvedValue({ businessModel: 'B2B', industry: 'Digital advertising agencies', payer: 'Agency owner',
    competition: [{ name: 'Optmyzr', offering, sourceIds: ['S1'] }] });
  const d = draft();
  d.kpis.priceUsd = 149;
  const stats = await researchFinalists([d], 'United States');
  expect(stats.coverage).toMatchObject({ comparableBuyerPools: 1, modeledChannels: 2, scenarioCac: 1 });
  expect(d.kpis.commercial?.market?.scope).toBe('comparable-cohort');
  expect(d.kpis.commercial?.cac?.channel).toBe('Blended CAC');
  expect(d.kpis.commercial?.channelMix?.weights).toHaveLength(2);
  expect(parseCommercial(d.kpis.commercial)).toEqual(d.kpis.commercial);
});

it('retains the published reference count through a search outage with no assumed buyer conversion', async () => {
  vi.mocked(marketSources).mockResolvedValueOnce([{
    id: 'M1', url: census.url, title: census.title, snippet: census.description, publishedAt: null,
    population: 20000, unit: 'professional photographers', period: '2025',
  }]);
  synth.mockResolvedValue({ businessModel: 'prosumer', marketReferenceId: 'M1' });
  const d = draft();
  const stats = await researchFinalists([d], geography);
  expect(stats.coverage).toMatchObject({referencePopulation: 1, reachableMarket: 0, acquisition: 0});
  expect(d.kpis.commercial?.marketReference).toEqual({
    population: 20000, unit: 'professional photographers', period: '2025', sourceIds: ['M1'],
  });
  expect(d.kpis.commercial?.market).toBeUndefined();
});

it('can retain an official survey count for a new industry outside the built-in sources', () => {
  const quote = 'In 2023 Canada recorded 12,000 music schools.';
  const source = {id: 'S1', url: 'https://www.statcan.gc.ca/survey', title: 'School survey', snippet: quote, publishedAt: null};
  const observedMarket = {sourceId: 'S1', quote, population: 12000, unit: 'music schools', year: 2023};
  const result = (unit: string) => buildCommercial({businessModel: 'B2B', observedMarket: {...observedMarket, unit}},
    [source], 'Canada', '2026-11-24T00:00:00.000Z');
  expect(result('music schools')?.marketReference?.population).toBe(12000);
  expect(result('students')).toBeNull();
});

it('keeps industry spending separate from the addressable market and customer count', () => {
  const source = {id: 'T1', url: 'https://example.org/industry-study', title: 'Industry expenditure',
    snippet: 'Merchants spent USD 2 billion on advertising.', publishedAt: null};
  const spending = {usd: 2e9, category: 'Merchant advertising spend', period: '2024', source};
  const p = buildCommercial({businessModel: 'B2B'}, [source], 'United States', '2026-11-24T00:00:00.000Z', [], spending);
  expect(p?.sectorSpending?.usd).toBe(2e9);
  expect(p?.marketReference).toBeUndefined();
  expect(p?.market).toBeUndefined();
});

it('ignores a malformed hit without losing usable results from the same response', async () => {
  fixture();
  search.mockReset().mockResolvedValueOnce([
    {...competitor, url: null, title: 4, description: []} as unknown as typeof competitor,
    competitor,
  ]).mockResolvedValue([]);
  const d = draft();
  await researchFinalists([d], geography);
  expect(d.kpis.commercial?.competition?.[0].name).toBe('FrameLab');
});

it('does not mislabel worldwide counts, revenue, years, other currencies or an unrelated host as local evidence', () => {
  const check = (marketQuote: string, cacQuote: string, host: string) => buildCommercial({
    ...findings, market: {...findings.market, quote: marketQuote}, cac: {...findings.cac, quote: cacQuote},
  }, [
    {id: 'S1', title: competitor.title, url: host, snippet: competitor.description, publishedAt: null},
    {id: 'S2', title: census.title, url: census.url, snippet: marketQuote, publishedAt: null},
    {id: 'S3', title: ads.title, url: ads.url, snippet: cacQuote, publishedAt: null},
  ], geography, '2025-03-15T00:00:00.000Z');
  const impostor = 'https://framelab.unrelated.com/offers';
  const partial = check('20,000 professional photographers in Japan.', 'Canada photo leads cost CAD $2.50 per click.', impostor);
  expect(partial?.market).toBeUndefined();
  expect(partial?.cac).toBeUndefined();
  expect(partial?.competition).toBeUndefined();
  expect(check('Worldwide revenue including Canada was USD 20,000.', ads.description, impostor)?.market).toBeUndefined();
  expect(check('Canada: sales of USD 20,000.', ads.description, impostor)?.market).toBeUndefined();
});

it('rejects social reposts even when the geography and numeric count match', () => {
  for (const url of ['https://old.reddit.com/r/photography', 'https://www.linkedin.com/posts/repost', 'https://x.com/post/12']) {
    const found = buildCommercial(findings, [{id: 'S2', title: census.title, url, snippet: census.description, publishedAt: null}],
      geography, '2025-03-15T00:00:00.000Z');
    expect(found?.market).toBeUndefined();
    expect(found?.sources.some(source => source.url === url)).not.toBe(true);
  }
});

it('accepts a localized app-store competitor and never treats a USD currency prefix as US geography', () => {
  const foreign = 'Photography ads in Japan cost US$2.50 per click.';
  const p = buildCommercial({...findings, cac: {...findings.cac, quote: foreign}}, [
    {id: 'S1', title: competitor.title, url: 'https://apps.apple.com/us/app/framelab/id12345', snippet: 'FrameLab photo tagging for iPhone.', publishedAt: null},
    {id: 'S3', title: ads.title, url: ads.url, snippet: foreign, publishedAt: null},
  ], 'United States', '2025-03-15T00:00:00.000Z');
  expect(p?.competition?.[0].name).toBe('FrameLab');
  expect(p?.cac).toBeUndefined();
});

it('retains a paid pilot and AI estimate when a provider returns short assumption bullets', async () => {
  fixture();
  synth.mockResolvedValue({...findings, industry: undefined, endUseIndustry: 'Photo editing',
    market: {...findings.market, assumptions: ['Count working photographers.', 'Filter for manual tagging.']},
    execution: {...findings.execution, assumptions: ['Recruit two paid pilots.', 'Use caption text as model input.']}});
  const d = draft();
  await researchFinalists([d], geography);
  expect(d.kpis.commercial).toMatchObject({
    industry: 'Photo editing', market: {buyerCounts: {base: 4000}},
    execution: {assumptions: 'Recruit two paid pilots. Use caption text as model input.', ai: {costPerTaskUsd: 0.000252}},
  });
});

it('keeps priced execution independently of market coverage and bounds overlong model assumptions', async () => {
  fixture();
  synth.mockResolvedValue({
    ...findings, market: null, cac: null, competition: [],
    execution: {...findings.execution, assumptions: 'Recruit one pilot photographer. '.repeat(15)},
  });
  const d = draft();
  await researchFinalists([d], geography);
  const p = d.kpis.commercial;
  expect(p?.execution).toMatchObject({pilotDays: 8, ai: {costPerTaskUsd: 0.000252}});
  expect(p?.execution?.assumptions.length).toBeLessThanOrEqual(360);
  expect(p?.market).toBeUndefined();
  expect(p?.cac).toBeUndefined();
  expect(p?.sources.map(s => s.id)).toEqual(['P1']);
  expect(buildCommercial(findings, [], geography, new Date().toISOString())).toBeNull();
});

it('retains audience for every daily idea even when search is unavailable and ignores proposal-injected research', async () => {
  const items = Array.from({length: 5}, (_, i) => ({...raw, slug: 'photo-' + i, researchTarget: {...raw.researchTarget, user: 'Photo\n  editors'}}));
  const daily = sanitizeOpportunities(items, new Set(), undefined, 6, true);
  await researchFinalists(daily, geography);
  expect(daily).toHaveLength(5);
  for (const d of daily) {
    expect(d.kpis.commercial).toBeUndefined();
    expect(sanitizeKpis(d.kpis).audience).toEqual({businessModel: 'prosumer', user: 'Photo editors', payer: 'Professional photographers', industry: 'Photography'});
  }
  expect(daily[0]!.kpis.audience).toBeDefined();
  expect(sanitizeOpportunities(items, new Set())[0]!.kpis.audience).toBeUndefined();
});

it('bounds search spend on expansion runs and skips synthesis on exhausted search', async () => {
  vi.stubEnv('EXA_API_KEY', 'offline');
  vi.stubEnv('BRAVE_API_KEY', 'offline');
  search.mockRejectedValue(new Error('budget exhausted'));
  vi.stubEnv('MINIMAX_API_KEY', 'offline');
  vi.mocked(braveSearch).mockRejectedValue(new Error('quota'));
  vi.mocked(minimaxSearch).mockRejectedValue(new Error('unavailable'));
  const drafts = Array.from({length: 20}, draft);
  const stats = await researchFinalists(drafts, geography);
  expect(search).toHaveBeenCalledTimes(9);
  expect(braveSearch).toHaveBeenCalledTimes(9);
  expect(minimaxSearch).toHaveBeenCalledTimes(9);
  expect(stats).toMatchObject({finalists: 3, enriched: 0, searchUnavailable: 3, adapterFailures: 27});
  expect(synth).not.toHaveBeenCalled();
  expect(drafts.every(d => !d.kpis.commercial)).toBe(true);
});

it('uses MiniMax after both other adapters fail and persists the profile on the public daily path only', async () => {
  const db = useTestDb();
  for (let i = 0; i < MIN_SIGNALS; i++) {
    db.insert(painPoints).values({ summary: 'Paid photo tagging pain ' + i, intensity: 3, evidence: '[]',
      createdAt: new Date(), lastSeenAt: new Date() }).run();
  }
  vi.stubEnv('OPP_GEOGRAPHY', geography);
  vi.stubEnv('EXA_API_KEY', 'offline');
  vi.stubEnv('BRAVE_API_KEY', 'offline');
  vi.stubEnv('MINIMAX_API_KEY', 'offline');
  search.mockRejectedValue(new Error('no budget'));
  vi.mocked(braveSearch).mockRejectedValue(new Error('quota'));
  vi.mocked(minimaxSearch).mockResolvedValueOnce([competitor]).mockResolvedValueOnce([census]).mockResolvedValueOnce([ads]);
  synth.mockResolvedValueOnce({ opportunities: [raw] }).mockResolvedValueOnce(findings);
  const result = await runOpportunities();
  expect(result.research).toMatchObject({ enriched: 1, adapterFailures: 6 });
  const stored = JSON.parse(db.select().from(opportunities).get()!.kpis!);
  expect(parseCommercial(stored.commercial)?.market?.buyerCounts.base).toBe(4000);
  const publicPrompt = synth.mock.calls[0]![0];
  expect(publicPrompt).toContain(geography);
  expect(publicPrompt).toContain('B2B2C');
  expect(publicPrompt).toContain('end-use industries');

  synth.mockResolvedValueOnce({ opportunities: [raw] });
  const personal = await proposeOpportunities({ b2b: false, skills: 'private photography project' });
  const [system, prompt] = synth.mock.calls.at(-1)!;
  expect(system).not.toContain('Public daily discovery');
  expect(prompt).toContain('private photography project');
  expect(prompt).toContain('market: B2C');
  expect(personal.drafts[0]?.kpis.commercial).toBeUndefined();
  expect(minimaxSearch).toHaveBeenCalledTimes(3);

  vi.stubEnv('MINIMAX_API_KEY', '');
  vi.stubEnv('EXA_API_KEY', '');
  vi.stubEnv('BRAVE_API_KEY', '');
  synth.mockResolvedValue({ opportunities: [raw] });
  const retry = await runOpportunities();
  expect(retry.research?.searchUnavailable).toBe(1);
  expect(JSON.parse(db.select().from(opportunities).get()!.kpis!).commercial).toEqual(stored.commercial);
  vi.stubEnv('OPP_GEOGRAPHY', 'Mexico');
  await runOpportunities();
  expect(JSON.parse(db.select().from(opportunities).get()!.kpis!).commercial).toBeUndefined();
});

it.each(['javascript:alert(1)', 'https://127.0.0.1/secret', 'https://user:pass@vendor.ca', 'https://foo..com/',
  'https://vendor.ca/?access_token=example', 'https://localhost./'])('rejects unusable or secret-bearing citation %s', u => {
  expect(commercialUrl(u)).toBeNull();
});

it.each([
  [{kind: 'direct', usdPerEvent: 48, eventsPerPayerMonth: 0.25}, 12],
  [{kind: 'commission', usdPerEvent: 200, eventsPerPayerMonth: 2, takeRate: 0.08}, 32],
  [{kind: 'advertising', usdPerEvent: 5, eventsPerPayerMonth: 15}, 75],
  [{kind: 'commission', usdPerEvent: 200, eventsPerPayerMonth: 2}, null],
  [{kind: 'direct', usdPerEvent: 48}, null],
])('normalizes monthly revenue per active payer using %j', (basis, expected) => {
  const proposal = {...raw, kpis: { priceUsd: 999, priceBasis: {...basis, payer: 'Paying customer', assumptions: 'Pilot billing cadence'} }};
  const [d] = sanitizeOpportunities([proposal], new Set(), undefined, 1, true);
  expect(d!.kpis.priceUsd).toBe(expected);
});

it('defaults to the US and accepts an explicit geography', () => {
  vi.stubEnv('OPP_GEOGRAPHY', '  ');
  expect(opportunityGeography()).toBe('United States');
  vi.stubEnv('OPP_GEOGRAPHY', 'Japan');
  expect(opportunityGeography()).toBe('Japan');
});

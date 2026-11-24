import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OppDossier from '@/components/OppDossier';
import { opportunities, painPoints } from '@/lib/db/schema';
import { chatJSON } from '@/lib/llm/minimax';
import { proposeOpportunities, runOpportunities, SUB_KEYS } from '@/lib/opportunities/engine';
import { MIN_SIGNALS } from '@/lib/opportunities/signals';
import { oppViewFromRow } from '@/lib/opportunities/view';
import { exaSearch } from '@/lib/search/exa';
import { braveSearch } from '@/lib/search/brave';
import { minimaxSearch } from '@/lib/search/minimax';
import { useTestDb } from './helpers/db';

vi.mock('@/lib/search/exa', () => ({ exaSearch: vi.fn() }));
vi.mock('@/lib/search/brave', () => ({ braveSearch: vi.fn() }));
vi.mock('@/lib/search/minimax', () => ({ minimaxSearch: vi.fn() }));
vi.mock('@/lib/llm/minimax', () => ({ chatJSON: vi.fn(), drainLlmUsageStats: () => ({}) }));
vi.mock('@/lib/opportunities/research', async (original) => ({
  ...await original<typeof import('@/lib/opportunities/research')>(),
  researchFinalists: vi.fn(),
}));
vi.mock('@/lib/opportunities/critic', () => ({ runCritique: vi.fn(async () => new Map()), runDebate: vi.fn() }));

let db: ReturnType<typeof useTestDb>;
function seed(count = MIN_SIGNALS) {
  const now = new Date();
  for (let i = 0; i < count; i++) {
    db.insert(painPoints).values({ summary: 'Existing signal ' + i, intensity: 2, evidence: '[]', lastSeenAt: now, createdAt: now }).run();
  }
}
const url = 'https://example.org/caregivers/survey';
const hit = { url, title: 'Caregiver survey', description: 'Families report <b>unfilled shifts</b>\nwhen care is cancelled.', publishedAt: null };
beforeEach(() => {
  db = useTestDb();
  vi.stubEnv('OPP_GEOGRAPHY', 'Canada');
  for (const key of ['EXA_API_KEY', 'BRAVE_API_KEY', 'MINIMAX_API_KEY']) vi.stubEnv(key, 'offline');
  vi.mocked(chatJSON).mockResolvedValue({ opportunities: [] });
  for (const search of [exaSearch, braveSearch, minimaxSearch]) vi.mocked(search).mockResolvedValue([]);
});
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('adds retrieved demand to the proposer and resolves its cited ref to the original public link', async () => {
  seed();
  vi.mocked(exaSearch).mockResolvedValue([
    { ...hit, title: 5 as unknown as string },
    { ...hit, url: 'https://example.org/private?access_token=secret', title: 'Unsafe source' },
    { ...hit, url: url + '#intro' }, hit,
  ]);
  vi.mocked(chatJSON).mockResolvedValueOnce({ opportunities: [{
    slug: 'care-relief', title: 'Fill cancelled caregiver shifts',
    thesis: 'Families repeatedly lose their booked caregiver shifts and need a same-day replacement.',
    subScores: Object.fromEntries(SUB_KEYS.map(k => [k, 12])),
    evidenceRefs: ['P1', 'P2', 'P3', 'P4', '[D1]', 'D2'], href: 'https://unrelated.com',
  }] });
  await runOpportunities();
  expect(exaSearch).toHaveBeenCalledTimes(1);
  expect(braveSearch).not.toHaveBeenCalled();
  const prompt = vi.mocked(chatJSON).mock.calls[0][1];
  expect(prompt).toContain('[D1]');
  expect(prompt).toContain('Families report unfilled shifts when care is cancelled.');
  expect(prompt).not.toMatch(/Unsafe source|access_token|\[D2\]/);
  const row = db.select().from(opportunities).get()!;
  const dossier = oppViewFromRow(row);
  expect(dossier.evidence).toHaveLength(5);
  expect(dossier.evidence[4]).toMatchObject({ label: hit.title, href: url });
  expect(renderToStaticMarkup(createElement(OppDossier, { opp: dossier, sortKey: 'flip' }))).toContain(`href="${url}"`);
  const corrupted = { ...row, evidence: JSON.stringify([{ type: 'demand', label: 'Old link', href: 'javascript:alert(1)' }]) };
  expect(oppViewFromRow(corrupted).evidence[0].href).toBeNull();
});

it('rotates one localized question at UTC midnight and tries each configured provider at most once', async () => {
  seed();
  vi.mocked(exaSearch).mockRejectedValue(new Error('budget exhausted'));
  vi.mocked(minimaxSearch).mockResolvedValue([hit]);
  const clock = vi.spyOn(Date, 'now');
  const midnight = Math.floor(new Date().getTime() / 86_400_000) * 86_400_000;
  for (const at of [midnight - 3_600_000, midnight - 1, midnight]) {
    clock.mockReturnValue(at);
    await proposeOpportunities(undefined, 'Canada');
  }
  const queries = vi.mocked(exaSearch).mock.calls.map(([opts]) => opts.query);
  expect(queries).toHaveLength(3);
  expect(queries[0]).toContain('Canada');
  expect(queries[0]).toContain('unmet needs');
  expect(queries[1]).toBe(queries[0]);
  expect(queries[2]).not.toBe(queries[1]);
  for (const adapter of [braveSearch, minimaxSearch]) {
    expect(vi.mocked(adapter).mock.calls.map(([opts]) => opts.query)).toEqual(queries);
  }
});

it('spends nothing on thin public runs or constrained scouts, and still proposes on a search outage', async () => {
  seed(MIN_SIGNALS - 1);
  await runOpportunities();
  expect(chatJSON).not.toHaveBeenCalled();
  seed(1);
  await proposeOpportunities({ skills: 'illustration' }, 'Canada');
  expect(chatJSON).toHaveBeenCalledTimes(1);
  for (const adapter of [exaSearch, braveSearch, minimaxSearch]) {
    expect(adapter).not.toHaveBeenCalled();
    vi.mocked(adapter).mockRejectedValue(new Error('unavailable'));
  }
  const { ctx } = await proposeOpportunities(undefined, 'Canada');
  expect(chatJSON).toHaveBeenCalledTimes(2);
  expect(ctx.signalCount).toBe(MIN_SIGNALS);
  expect(ctx.refMap.has('D1')).toBe(false);
  expect(braveSearch).toHaveBeenCalledTimes(1);
});

import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import CommercialResearch from '@/components/CommercialResearch';
import { applyComparableEconomics } from '@/lib/opportunities/comparable-economics';
import { comparableBuyers } from '@/lib/opportunities/comparable-buyers';
import { comparableChannels } from '@/lib/opportunities/channel-cac';
import { comparableMix } from '@/lib/opportunities/channel-mix';
import { parseCommercial } from '@/lib/opportunities/commercial';
import { commercialFixture } from './fixtures/opportunity-commercial';

vi.mock('@/lib/opportunities/comparable-buyers', () => ({ comparableBuyers: vi.fn() }));
vi.mock('@/lib/opportunities/channel-cac', () => ({ comparableChannels: vi.fn() }));
vi.mock('@/lib/opportunities/channel-mix', () => ({ comparableMix: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const profile = { ...commercialFixture, geography: 'United States' };
const paid = { channel: 'Paid search', assumptions: 'Cost per click divided by click-to-paid conversion.',
  usd: { low: 120, base: 200, high: 350 }, sourceIds: ['C1'] };
function scenarios() {
  vi.mocked(comparableChannels).mockReturnValue({
    channels: [paid, { ...paid, channel: 'Publisher referrals', usd: { low: 50, base: 75, high: 125 } }],
    sources: [{ ...profile.sources[0], id: 'C1' }],
  });
}

it('reuses citations, keeps the primary channel fixed and replays identically', () => {
  scenarios();
  const p = applyComparableEconomics(profile, 49);
  expect(p.sources).toEqual(profile.sources);
  expect(p.cac).toMatchObject({ kind: 'scenario', channel: 'Paid search', usd: paid.usd, sourceIds: ['S1'] });
  expect(applyComparableEconomics(p, 49)).toEqual(p);
  const html = renderToStaticMarkup(createElement(CommercialResearch, { profile: p }));
  for (const text of ['Estimated CAC by channel', 'Publisher referrals', 'Primary channel for ranking', paid.assumptions]) {
    expect(html).toContain(text);
  }
  expect(parseCommercial({ ...p, cac: { ...p.cac, usd: { low: 1, base: 2, high: 3 } } })).toBeNull();
});

it('keeps a matched observed CAC in payback when adding channel scenarios', () => {
  scenarios();
  const p = applyComparableEconomics({ ...profile,
    cac: { ...paid, kind: 'observed', usd: {low: 90, base: 90, high: 90}, sourceIds: ['S1'] },
    cacReferences: [{publisher: 'Survey', geography: 'United States', scope: 'matched', period: '2025',
      cohort: 'Studios', unit: 'paying customer', usd: 90, channel: paid.channel, methodology: 'Matched cohort', sourceIds: ['S1']}],
  }, 49);
  expect(p.cac?.kind).toBe('observed');
  expect(p.cacChannels).toHaveLength(2);
});

it('weights paying customers in each scenario, validates citations and rejects inconsistent totals', () => {
  scenarios();
  const weights = [
    { channel: 'Publisher referrals', favorable: 80, base: 50, adverse: 25 },
    { channel: 'Paid search', favorable: 20, base: 50, adverse: 75 },
  ];
  vi.mocked(comparableMix).mockReturnValue({ weights, assumptions: 'Shares among paying customers.',
    sources: [{ ...profile.sources[1], id: 'W1' }] });
  const p = applyComparableEconomics(profile, 49);
  expect(p.channelMix?.usd).toEqual({ low: 64, base: 137.5, high: 293.75 });
  expect(p.cac).toMatchObject({ channel: 'Blended CAC', usd: p.channelMix?.usd, sourceIds: ['S2', 'S1'] });
  expect(applyComparableEconomics(p, 49)).toEqual(p);
  for (const mix of [{ ...p.channelMix, usd: paid.usd }, { ...p.channelMix, sourceIds: ['S2'] },
    { ...p.channelMix, weights: [weights[0], weights[0]] },
    { ...p.channelMix, weights: [weights[0], { ...weights[1], adverse: 74 }] }]) {
    expect(parseCommercial({ ...p, channelMix: mix })).toBeNull();
  }
});

it('retains both excerpts when another measurement comes from an existing report', () => {
  vi.mocked(comparableBuyers).mockReturnValue({ market: { ...profile.market!, sourceIds: ['B1'] },
    sources: [{ ...profile.sources[0], id: 'B1', snippet: 'Additional qualified segment count.' }] });
  const p = applyComparableEconomics(profile, 49);
  expect(p.sources[0]).toMatchObject({ snippet: profile.sources[0].snippet,
    comparableEvidence: { snippet: 'Additional qualified segment count.' } });
  expect(p.market?.sourceIds).toEqual(['S1']);
  expect(applyComparableEconomics(p, 49)).toEqual(p);
});

it('keeps source ID collisions separate from unrelated existing evidence', () => {
  const source = { ...profile.sources[1], id: 'B1', url: 'https://example.org/product-survey' };
  vi.mocked(comparableBuyers).mockReturnValue({ market: { ...profile.market!, sourceIds: ['B1'] }, sources: [source] });
  const p = applyComparableEconomics({ ...profile, sources: [...profile.sources,
    { ...source, url: 'https://example.org/older-study' }] }, 49);
  expect(p.market?.sourceIds).toEqual(['B2']);
  expect(p.sources.find(s => s.id === 'B2')?.url).toBe(source.url);
  expect(applyComparableEconomics(p, 49)).toEqual(p);
});

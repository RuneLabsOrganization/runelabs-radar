import { expect, it } from 'vitest';
import { commercialFixture } from './fixtures/opportunity-commercial';
import { matchedUsComparable } from '@/lib/opportunities/comparable-product';

const sample = { ...commercialFixture, geography: 'United States', payer: 'Agency owner', industry: 'Digital advertising',
  competition: [{ name: 'Optmyzr', offering: 'Multi-account PPC management', sourceIds: ['V1'] }],
  sources: [{ id: 'V1', url: 'https://www.optmyzr.com/', title: 'Optmyzr', snippet: 'Multi-account PPC management', publishedAt: null }] };

it('requires the applicable geography, payer, segment and a cited publisher', () => {
  expect(matchedUsComparable(sample)).toBe('optmyzr');
  expect(matchedUsComparable({ ...sample, geography: 'United Kingdom' })).toBeUndefined();
  expect(matchedUsComparable({ ...sample, payer: 'Homeowner' })).toBeUndefined();
  expect(matchedUsComparable({ ...sample, industry: 'Travel' })).toBeUndefined();
  expect(matchedUsComparable({ ...sample, sources: [] })).toBeUndefined();
  expect(matchedUsComparable({ ...sample, sources: [{ ...sample.sources[0], url: 'https://optmyzr.com.example.org/' }] })).toBeUndefined();
});

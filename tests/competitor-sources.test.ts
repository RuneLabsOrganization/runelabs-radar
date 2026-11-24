import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import CommercialResearch from '@/components/CommercialResearch';
import { parseCommercial, type CommercialSource } from '@/lib/opportunities/commercial';
import { buildCommercial } from '@/lib/opportunities/research-findings';
import { competitorSources } from '@/lib/opportunities/competitor-sources';

const source: CommercialSource = {
  id: 'V1', title: 'Optmyzr | PPC Management Software', url: 'https://www.optmyzr.com/',
  snippet: 'Optmyzr automates paid campaign reporting for agencies.', publishedAt: null,
};
const date = '2026-06-01T00:00:00Z';
function assess(s = source, offering = 'Paid campaign reporting', name = 'Optmyzr') {
  return buildCommercial({ businessModel: 'B2B', competition: [{ name, offering, sourceIds: [s.id] }] }, [s], 'Canada', date);
}
afterEach(() => vi.unstubAllGlobals());

const draft = (title: string) => ({ title });

it.each([
  ['Shopify conversion diagnostics', 'Elevar', 'https://apps.shopify.com/gtm-datalayer-by-elevar', 'Capture conversion events with server-side tracking.'],
  ['Core Web Vitals performance monitoring', 'DebugBear', 'https://www.debugbear.com/', 'Monitor page speed and real user performance.'],
  ['Agency call tracking for lead gen', 'CallRail', 'https://www.callrail.com/call-tracking', 'Attribute phone calls to marketing campaigns.'],
  ['Shopify analytics for merchants', 'Better Reports', 'https://apps.shopify.com/betterreports', 'Build custom reports for store sales.'],
  ['Visual web QA', 'Percy', 'https://www.browserstack.com/percy', 'Compare screenshots to automate visual testing.'],
  ['PPC agency', 'Optmyzr', 'https://www.optmyzr.com/', 'Automate paid campaign reporting for agencies.'],
  ['B2B lead gen', 'Apollo Data', 'https://www.apollo.io/product/b2b-data', 'Find sales prospects with a verified contact database.'],
])('collects a named, working product page for %s', async (topic, name, url, description) => {
  const fetch = vi.fn(async () => new Response(`<title>${name}</title><meta content="${description}" name="description">`));
  vi.stubGlobal('fetch', fetch);
  const collected = await competitorSources(draft(topic), 'Canada');
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  expect(collected[0]).toEqual({ id: 'V1', url, title: name, snippet: description, publishedAt: null });
  expect(assess(collected[0], description, name)?.competition?.[0].availability).toBe('unconfirmed');
});

it('skips unrelated proposals and drops inaccessible or repurposed catalog pages', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('timed out')).mockResolvedValueOnce(new Response(
    '<title>Domain for sale</title><meta name=description content="Buy this domain today">'));
  vi.stubGlobal('fetch', fetch);
  expect(await competitorSources(draft('School lunch allergy labels'), 'Canada')).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  for (let i = 0; i < 2; i++) expect(await competitorSources(draft('Shopify sales reports'), 'Canada')).toEqual([]);
});

it('uses a localized Apple software search and keeps only relevant, matching app IDs and storefronts', async () => {
  const listing = { kind: 'software', trackName: 'Practice Diary', trackId: 12345,
    trackViewUrl: 'https://apps.apple.com/ca/app/practice-diary/id12345', description: 'Track piano practice sessions and routines.' };
  const fetch = vi.fn(async () => Response.json({ results: [
    { ...listing, trackViewUrl: 'https://example.org/id12345' },
    { ...listing, trackViewUrl: listing.trackViewUrl.replace('12345', '67123') },
    { ...listing, trackViewUrl: listing.trackViewUrl.replace('/ca/', '/us/') },
    { ...listing, trackName: 'BuildCast', description: 'Manage industrial construction crews.' },
    listing, listing,
  ] }));
  vi.stubGlobal('fetch', fetch);
  const found = await competitorSources(draft('iPhone piano practice'), 'Canada');
  const [request] = vi.mocked(globalThis.fetch).mock.calls[0];
  const api = new URL(String(request));
  expect(api.origin + api.pathname).toBe('https://itunes.apple.com/search');
  expect(api.searchParams.get('country')).toBe('ca');
  expect(api.searchParams.get('entity')).toBe('software');
  expect(found).toEqual([{ id: 'V1', url: listing.trackViewUrl, title: listing.trackName, snippet: listing.description, publishedAt: null }]);
});

it('cites the actual product offering and marks local availability explicitly', () => {
  const profile = assess()!;
  expect(profile?.competition).toEqual([{
    name: 'Optmyzr', offering: source.snippet, availability: 'unconfirmed', sourceIds: ['V1'],
  }]);
  const html = renderToStaticMarkup(createElement(CommercialResearch, { profile }));
  expect(html).toContain('Local availability unconfirmed');
  expect(html).toContain('href="https://www.optmyzr.com/"');
});

it('requires evidence for the offering even when the brand, geography and source ID match', () => {
  const local = { ...source, snippet: source.snippet + ' Available in Canada.' };
  expect(assess(local, 'Automatically prepares payroll tax returns')).toBeNull();
  expect(assess(local)?.competition?.[0].availability).toBe('confirmed');
  expect(assess({ ...source, snippet: source.snippet + ' Not available in Canada.' })?.competition?.[0].availability).toBe('unconfirmed');
  expect(assess({ ...source, snippet: source.snippet + ' Research conducted in Canada.' })?.competition?.[0].availability).toBe('unconfirmed');
  expect(assess({ ...source, snippet: source.snippet + ' Available in Japan for visitors from Canada.' })?.competition?.[0].availability).toBe('unconfirmed');
  expect(assess({ ...source, snippet: 'Optmyzr does not provide payroll tax reporting.' }, 'Payroll tax reporting')).toBeNull();
});

it('recognizes the named Shopify offering when the installation slug identifies its publisher', () => {
  const s = { ...source, title: 'Elevar Conversion Tracking | Shopify App Store',
    url: 'https://apps.shopify.com/gtm-datalayer-by-elevar', snippet: 'Capture conversions with server-side tracking.' };
  expect(assess(s, 'Server-side tracking', 'Elevar Conversion Tracking')?.competition?.[0].sourceIds).toEqual(['V1']);
});

it('retains the verified CallRail listing URL when the publisher request fails', async () => {
  const description = 'Attribute phone calls to marketing campaigns.';
  const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response(
    `<title>CallRail Phone Call Tracking – WordPress plugin</title><meta name=description content="${description}">`));
  vi.stubGlobal('fetch', fetch);
  const [s] = await competitorSources(draft('Call attribution'), 'Canada');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(s.url).toBe('https://wordpress.org/plugins/callrail-phone-call-tracking/');
  expect(assess(s, description, 'CallRail')?.competition?.[0].offering).toBe(description);
});

it('rejects a marketplace listing for a different product that mentions the claimed name', () => {
  const other = { ...source, title: 'Lead Atlas – works with Optmyzr',
    url: 'https://play.google.com/store/apps/details?id=com.example.leadatlas&gl=ca' };
  expect(assess(other)).toBeNull();
});

it('accepts a named storefront listing and rejects search, collection and unrelated product pages', () => {
  const listing = { ...source, title: 'Optmyzr on the App Store', url: 'https://apps.apple.com/ca/app/optmyzr/id123456' };
  expect(assess(listing)?.competition?.[0].availability).toBe('confirmed');
  expect(assess({ ...listing, url: listing.url.replace('/ca/', '/us/') })?.competition?.[0].availability).toBe('unconfirmed');
  for (const url of ['https://apps.apple.com/ca/search?term=optmyzr', 'https://apps.shopify.com/categories/marketing',
    'https://apps.shopify.com/another-product', 'https://optmyzr.unrelated.com/product', 'https://www.optmyzr.com/blog/review']) {
    expect(assess({ ...listing, url })).toBeNull();
  }
});

it('reads legacy competition without inferring availability', () => {
  const profile = parseCommercial({ geography: 'Canada', businessModel: 'B2B', researchedAt: date, sources: [source],
    competition: [{ name: 'Optmyzr', offering: 'Historical summary', sourceIds: ['V1'] }] });
  expect(profile?.competition?.[0].offering).toBe('Historical summary');
  expect(renderToStaticMarkup(createElement(CommercialResearch, { profile: profile! }))).toContain('Local availability unconfirmed');
});

import { describe, expect, it } from 'vitest';
import { comparableChannels } from '@/lib/opportunities/channel-cac';
import { comparableMix } from '@/lib/opportunities/channel-mix';
import type { CommercialProfile } from '@/lib/opportunities/commercial';

const products = {
  optmyzr: ['Optmyzr', 'https://www.optmyzr.com/', 'PPC agencies', 'Paid search'],
  elevar: ['Elevar', 'https://apps.shopify.com/gtm-datalayer-by-elevar', 'Shopify merchant', 'E-commerce analytics'],
  voluum: ['Voluum', 'https://voluum.com/', 'Affiliate media buyers', 'Affiliate attribution'],
} as const;
type Product = keyof typeof products;

function profile(product: Product, price: number | null = 39) {
  const [name, url, payer, industry] = products[product];
  const p: CommercialProfile = {
    geography: 'United States', businessModel: 'B2B', payer, industry, researchedAt: '2026-11-24T00:00:00.000Z',
    competition: [{ name, offering: industry, sourceIds: ['V1'] }],
    sources: [{ id: 'V1', title: name, url, snippet: industry, publishedAt: null }],
  };
  const routes = comparableChannels(p, price)!;
  return { ...p, cacChannels: routes.channels, sources: [...p.sources, ...routes.sources] };
}

describe('conditional shares of new paying accounts', () => {
  it.each(['optmyzr', 'elevar', 'voluum'] as const)('covers exactly the modeled %s routes and sums each scenario to 100', product => {
    const p = profile(product);
    const mix = comparableMix(p)!;
    expect(mix.weights.map(w => w.channel)).toEqual(p.cacChannels.map(c => c.channel));
    for (const scenario of ['favorable', 'base', 'adverse'] as const) {
      const shares = mix.weights.map(w => w[scenario]);
      expect(shares.every(n => Number.isInteger(n) && n >= 0 && n <= 100)).toBe(true);
      expect(shares.reduce((sum, n) => sum + n, 0)).toBe(100);
    }
    expect(mix.assumptions.length).toBeLessThanOrEqual(600);
    expect(mix.assumptions).toContain('new paying accounts');
    expect(mix.assumptions).toContain('Exclude organic and other routes');
    expect(new Set(mix.sources.map(s => s.id)).size).toBe(mix.sources.length);
    expect(mix.sources.every(s => s.snippet.length <= 600 && s.url.startsWith('https://'))).toBe(true);
    expect(comparableMix({ ...p, cacChannels: [...p.cacChannels].reverse() })).toEqual(mix);
    expect(comparableMix(profile(product, null))).toBeUndefined();
  });

  it('uses distinct launch and established referral sensitivities for customer advocates and publishers', () => {
    const agencies = comparableMix(profile('optmyzr'))!;
    const publishers = comparableMix(profile('voluum'))!;
    expect(agencies.weights[1]).toEqual({ channel:'PPC agency customer referrals', favorable:35, base:20, adverse:10 });
    expect(publishers.weights[0]).toEqual({ channel:'Affiliate publisher referrals', favorable:50, base:30, adverse:15 });
    expect(agencies.sources[0].snippet).toContain('incoming customers');
    expect(publishers.sources[0].snippet).toContain('new customers');
  });

  it('splits equal all-in paid budgets into payer counts using each Shopify scenario’s CAC', () => {
    const p = profile('elevar');
    expect(comparableMix(p)!.weights).toEqual([
      {channel:'US Shopify App Store search ads', favorable:47, base:58, adverse:64},
      {channel:'US paid search', favorable:3, base:9, adverse:21},
      {channel:'Shopify implementation agency referrals', favorable:50, base:33, adverse:15},
    ]);
    const sameCost = p.cacChannels.map(c => ({ ...c, usd: {low:100, base:200, high:300} }));
    expect(comparableMix({...p, cacChannels:sameCost})!.weights[0]).toMatchObject({favorable:25, base:34, adverse:43});
    const invalid = sameCost.map(c => ({ ...c, usd: { ...c.usd, high:Infinity } }));
    expect(comparableMix({...p, cacChannels:invalid})).toBeUndefined();
  });

  it('rejects missing, repeated, unexpected or unverified routes without renormalizing', () => {
    const p = profile('elevar');
    const [store, web, partner] = p.cacChannels;
    for (const cacChannels of [undefined, [], [web, partner], [store, partner], [store, web], [store, store, partner],
      [store, web, {...partner, channel:'Affiliate publisher referrals'}], [...p.cacChannels, web]]) {
      expect(comparableMix({...p, cacChannels})).toBeUndefined();
    }
    expect(comparableMix({...p, geography:'Canada'})).toBeUndefined();
    expect(comparableMix({...p, sources:[]})).toBeUndefined();
  });
});

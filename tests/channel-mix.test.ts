import { describe, expect, it } from 'vitest';
import { comparableChannels, founderPilotPayers } from '@/lib/opportunities/channel-cac';
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

describe('launch mix for the first ten US paying accounts', () => {
  it.each(['optmyzr', 'elevar', 'voluum'] as const)('covers exactly the modeled %s routes with 10,000 bps per scenario', product => {
    const p = profile(product);
    const mix = comparableMix(p)!;
    expect(mix.weights.map(w => w.channel)).toEqual(p.cacChannels.map(c => c.channel));
    for (const scenario of ['favorable', 'base', 'adverse'] as const) {
      const shares = mix.weights.map(w => w[scenario]);
      const bps = shares.map(n => Math.round(n * 100));
      expect(bps.every(n => n >= 0 && n <= 10_000)).toBe(true);
      expect(bps.map(n => n / 100)).toEqual(shares);
      expect(bps.reduce((sum, n) => sum + n, 0)).toBe(10_000);
      const pilots = founderPilotPayers();
      expect(bps.slice(-2)).toEqual([pilots.organic, pilots.outbound].map(p => Math.round(p[scenario] * 1000)));
    }
    expect(mix.assumptions.length).toBeLessThanOrEqual(600);
    expect(mix.assumptions).toContain('First 10 US payers');
    expect(mix.assumptions).toContain('first source once');
    expect(mix.assumptions).toContain('~1,961 contacts/~162h');
    expect(mix.weights.slice(-2)).toEqual([
      {channel:'US organic inbound', favorable:3.20, base:1.60, adverse:0.80},
      {channel:'US founder-led outbound', favorable:3.06, base:1.53, adverse:0.77},
    ]);
    // No single missing route (including either pilot) may inflate the others.
    for (const missing of p.cacChannels) {
      expect(comparableMix({...p, cacChannels:p.cacChannels.filter(c => c !== missing)})).toBeUndefined();
    }
    expect(new Set(mix.sources.map(s => s.id)).size).toBe(mix.sources.length);
    expect(mix.sources.every(s => s.snippet.length <= 600 && s.url.startsWith('https://'))).toBe(true);
    expect(comparableMix({ ...p, cacChannels: [...p.cacChannels].reverse() })).toEqual(mix);
    expect(comparableMix(profile(product, null))).toBeUndefined();
  });

  it('uses distinct launch and established referral sensitivities for customer advocates and publishers', () => {
    const agencies = comparableMix(profile('optmyzr'))!;
    const publishers = comparableMix(profile('voluum'))!;
    expect(agencies.weights[1]).toEqual({ channel:'PPC agency customer referrals', favorable:32.81, base:19.37, adverse:9.84 });
    expect(publishers.weights[0]).toEqual({ channel:'Affiliate publisher referrals', favorable:46.87, base:29.06, adverse:14.76 });
    expect(agencies.sources[0].url).toContain('wordstream-with-larry-kim');
    expect(publishers.sources[0].url).toContain('everflow-sam-darawish-459');
    expect(publishers.assumptions).toContain('No booth or warm-contact sales assumed');
  });

  it('splits equal all-in paid budgets into payer counts using each Shopify scenario’s CAC', () => {
    const p = profile('elevar');
    expect(comparableMix(p)!.weights).toEqual([
      {channel:'US Shopify App Store search ads', favorable:43.70, base:56.40, adverse:62.74},
      {channel:'US paid search', favorable:3.17, base:8.50, adverse:20.93},
      {channel:'Shopify implementation agency referrals', favorable:46.87, base:31.97, adverse:14.76},
      {channel:'US organic inbound', favorable:3.20, base:1.60, adverse:0.80},
      {channel:'US founder-led outbound', favorable:3.06, base:1.53, adverse:0.77},
    ]);
    expect(comparableMix(p)!.assumptions).toContain('unpaid store discovery is outside this plan');
    const sameCost = p.cacChannels.map(c => ({ ...c, usd: {low:100, base:200, high:300} }));
    expect(comparableMix({...p, cacChannels:sameCost})!.weights[0]).toMatchObject({favorable:23.44, base:32.45, adverse:41.84});
    const invalid = sameCost.map(c => ({ ...c, usd: { ...c.usd, high:Infinity } }));
    expect(comparableMix({...p, cacChannels:invalid})).toBeUndefined();
  });

  it('rejects missing, repeated, unexpected or unverified routes without renormalizing', () => {
    const p = profile('elevar');
    const [store, web, partner, guide, email] = p.cacChannels;
    for (const cacChannels of [undefined, [], [store, store, partner, guide, email],
      [store, web, {...partner, channel:'Affiliate publisher referrals'}, guide, email], [...p.cacChannels, web]]) {
      expect(comparableMix({...p, cacChannels})).toBeUndefined();
    }
    expect(comparableMix({...p, geography:'Canada'})).toBeUndefined();
    expect(comparableMix({...p, sources:[]})).toBeUndefined();
  });
});

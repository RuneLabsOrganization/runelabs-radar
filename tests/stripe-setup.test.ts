import { describe, expect, it, vi } from 'vitest';
import { ensureRadarPrices, runStripeSetup, type StripeCatalog } from '../scripts/stripe-setup';

function mockStripe(seed?: {
  products?: Array<{ id: string; name: string }>;
  prices?: Record<string, Array<{
    id: string;
    unit_amount: number | null;
    currency: string;
    recurring: { interval: string } | null;
  }>>;
}): StripeCatalog & {
  createdProducts: string[];
  createdPrices: Array<{ product: string; unit_amount: number; interval: string }>;
} {
  const products = [...(seed?.products ?? [])];
  const prices = { ...(seed?.prices ?? {}) };
  const createdProducts: string[] = [];
  const createdPrices: Array<{ product: string; unit_amount: number; interval: string }> = [];
  let productSeq = products.length;
  let priceSeq = 0;

  return {
    createdProducts,
    createdPrices,
    products: {
      async list() {
        return { data: products };
      },
      async create({ name }) {
        productSeq += 1;
        const product = { id: `prod_${productSeq}`, name };
        products.push(product);
        createdProducts.push(name);
        prices[product.id] = prices[product.id] ?? [];
        return product;
      },
    },
    prices: {
      async list({ product }) {
        return { data: prices[product] ?? [] };
      },
      async create(params) {
        priceSeq += 1;
        const price = {
          id: `price_${priceSeq}`,
          unit_amount: params.unit_amount,
          currency: params.currency,
          recurring: { interval: params.recurring.interval },
        };
        prices[params.product] = [...(prices[params.product] ?? []), price];
        createdPrices.push({
          product: params.product,
          unit_amount: params.unit_amount,
          interval: params.recurring.interval,
        });
        return { id: price.id };
      },
    },
  };
}

describe('ensureRadarPrices', () => {
  it('creates Builder and Factory products with monthly and annual USD prices', async () => {
    const stripe = mockStripe();
    const ids = await ensureRadarPrices(stripe);

    expect(stripe.createdProducts).toEqual(['Radar Builder', 'Radar Factory']);
    expect(stripe.createdPrices).toEqual([
      { product: 'prod_1', unit_amount: 1900, interval: 'month' },
      { product: 'prod_1', unit_amount: 19000, interval: 'year' },
      { product: 'prod_2', unit_amount: 4900, interval: 'month' },
      { product: 'prod_2', unit_amount: 49000, interval: 'year' },
    ]);
    expect(ids).toEqual({
      STRIPE_PRICE_BUILDER: 'price_1',
      STRIPE_PRICE_BUILDER_ANNUAL: 'price_2',
      STRIPE_PRICE_FACTORY: 'price_3',
      STRIPE_PRICE_FACTORY_ANNUAL: 'price_4',
    });
  });

  it('reuses existing products and matching prices', async () => {
    const stripe = mockStripe({
      products: [
        { id: 'prod_builder', name: 'Radar Builder' },
        { id: 'prod_factory', name: 'Radar Factory' },
      ],
      prices: {
        prod_builder: [
          { id: 'price_b_mo', unit_amount: 1900, currency: 'usd', recurring: { interval: 'month' } },
          { id: 'price_b_yr', unit_amount: 19000, currency: 'usd', recurring: { interval: 'year' } },
        ],
        prod_factory: [
          { id: 'price_f_mo', unit_amount: 4900, currency: 'usd', recurring: { interval: 'month' } },
          { id: 'price_f_yr', unit_amount: 49000, currency: 'usd', recurring: { interval: 'year' } },
        ],
      },
    });

    const ids = await ensureRadarPrices(stripe);
    expect(stripe.createdProducts).toEqual([]);
    expect(stripe.createdPrices).toEqual([]);
    expect(ids).toEqual({
      STRIPE_PRICE_BUILDER: 'price_b_mo',
      STRIPE_PRICE_BUILDER_ANNUAL: 'price_b_yr',
      STRIPE_PRICE_FACTORY: 'price_f_mo',
      STRIPE_PRICE_FACTORY_ANNUAL: 'price_f_yr',
    });
  });
});

describe('runStripeSetup', () => {
  it('exits 1 when STRIPE_SECRET_KEY is missing', async () => {
    const exit = vi.fn();
    const error = vi.fn();
    const createStripe = vi.fn();
    await runStripeSetup({
      env: {},
      createStripe,
      log: vi.fn(),
      error,
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(createStripe).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toMatch(/STRIPE_SECRET_KEY/);
  });

  it('prints price env lines and never prints the secret', async () => {
    const secret = 'sk_test_DO_NOT_PRINT_THIS';
    const logs: string[] = [];
    const stripe = mockStripe();
    const exit = vi.fn();
    await runStripeSetup({
      env: { STRIPE_SECRET_KEY: secret },
      createStripe: () => stripe,
      log: (msg) => logs.push(msg),
      error: vi.fn(),
      exit,
    });
    expect(exit).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('STRIPE_PRICE_BUILDER=price_1');
    expect(out).toContain('STRIPE_PRICE_BUILDER_ANNUAL=price_2');
    expect(out).toContain('STRIPE_PRICE_FACTORY=price_3');
    expect(out).toContain('STRIPE_PRICE_FACTORY_ANNUAL=price_4');
    expect(out).not.toContain(secret);
    expect(out).not.toMatch(/STRIPE_SECRET_KEY=/);
  });
});

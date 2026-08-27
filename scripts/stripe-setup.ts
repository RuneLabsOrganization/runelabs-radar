import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { loadDotEnv } from '../src/lib/env';

export type StripeCatalog = {
  products: {
    list: (params?: { active?: boolean; limit?: number }) => Promise<{ data: Array<{ id: string; name: string }> }>;
    create: (params: { name: string }) => Promise<{ id: string; name: string }>;
  };
  prices: {
    list: (params: { product: string; active?: boolean; limit?: number }) => Promise<{
      data: Array<{
        id: string;
        unit_amount: number | null;
        currency: string;
        recurring: { interval: string } | null;
      }>;
    }>;
    create: (params: {
      product: string;
      currency: string;
      unit_amount: number;
      recurring: { interval: 'month' | 'year' };
    }) => Promise<{ id: string }>;
  };
};

const PLANS = [
  {
    name: 'Radar Builder',
    monthlyCents: 1900,
    annualCents: 19000,
    monthlyEnv: 'STRIPE_PRICE_BUILDER',
    annualEnv: 'STRIPE_PRICE_BUILDER_ANNUAL',
  },
  {
    name: 'Radar Factory',
    monthlyCents: 4900,
    annualCents: 49000,
    monthlyEnv: 'STRIPE_PRICE_FACTORY',
    annualEnv: 'STRIPE_PRICE_FACTORY_ANNUAL',
  },
] as const;

async function findOrCreateProduct(stripe: StripeCatalog, name: string) {
  const listed = await stripe.products.list({ active: true, limit: 100 });
  const existing = listed.data.find((p) => p.name === name);
  if (existing) return existing;
  return stripe.products.create({ name });
}

function matchingPrice(
  prices: Array<{
    id: string;
    unit_amount: number | null;
    currency: string;
    recurring: { interval: string } | null;
  }>,
  unitAmount: number,
  interval: 'month' | 'year',
) {
  return prices.find(
    (p) => p.currency === 'usd' && p.unit_amount === unitAmount && p.recurring?.interval === interval,
  );
}

async function findOrCreatePrice(
  stripe: StripeCatalog,
  productId: string,
  unitAmount: number,
  interval: 'month' | 'year',
) {
  const listed = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const existing = matchingPrice(listed.data, unitAmount, interval);
  if (existing) return existing;
  return stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval },
  });
}

export async function ensureRadarPrices(stripe: StripeCatalog): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const plan of PLANS) {
    const product = await findOrCreateProduct(stripe, plan.name);
    const monthly = await findOrCreatePrice(stripe, product.id, plan.monthlyCents, 'month');
    const annual = await findOrCreatePrice(stripe, product.id, plan.annualCents, 'year');
    ids[plan.monthlyEnv] = monthly.id;
    ids[plan.annualEnv] = annual.id;
  }
  return ids;
}

export async function runStripeSetup(opts: {
  env: NodeJS.Dict<string>;
  createStripe: (key: string) => StripeCatalog;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  exit?: (code: number) => void;
}): Promise<void> {
  const log = opts.log ?? ((msg) => console.log(msg));
  const error = opts.error ?? ((msg) => console.error(msg));
  const exit = opts.exit ?? ((code) => process.exit(code));
  const key = opts.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    error('STRIPE_SECRET_KEY is required');
    exit(1);
    return;
  }
  const ids = await ensureRadarPrices(opts.createStripe(key));
  for (const name of [
    'STRIPE_PRICE_BUILDER',
    'STRIPE_PRICE_BUILDER_ANNUAL',
    'STRIPE_PRICE_FACTORY',
    'STRIPE_PRICE_FACTORY_ANNUAL',
  ]) {
    log(`${name}=${ids[name]}`);
  }
}

async function main() {
  loadDotEnv();
  await runStripeSetup({
    env: process.env,
    createStripe: (key) => new Stripe(key) as unknown as StripeCatalog,
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

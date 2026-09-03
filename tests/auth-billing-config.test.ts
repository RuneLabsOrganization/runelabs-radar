import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestDb } from './helpers/db';

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_BUILDER',
  'STRIPE_PRICE_FACTORY',
] as const;
const ORIG = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  useTestDb();
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('stripe misconfiguration footguns', () => {
  it('warns at startup when STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await import('@/lib/auth/better-auth');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('STRIPE_WEBHOOK_SECRET'));
    warn.mockRestore();
  });

  it('stays quiet when both keys are set, and when stripe is not configured at all', async () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('@/lib/auth/better-auth');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('@/lib/auth/better-auth');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('checkoutPlans fails fast with a clear error while a priceId is still the placeholder', async () => {
    const mod = await import('@/lib/auth/better-auth');
    await expect(mod.checkoutPlans()).rejects.toThrow(/STRIPE_PRICE_BUILDER/);
  });

  it('checkoutPlans names the factory variable when only builder is configured', async () => {
    process.env.STRIPE_PRICE_BUILDER = 'price_real_builder';
    const mod = await import('@/lib/auth/better-auth');
    await expect(mod.checkoutPlans()).rejects.toThrow(/STRIPE_PRICE_FACTORY/);
  });

  it('checkoutPlans returns the plans once real price ids are configured', async () => {
    process.env.STRIPE_PRICE_BUILDER = 'price_real_builder';
    process.env.STRIPE_PRICE_FACTORY = 'price_real_factory';
    const mod = await import('@/lib/auth/better-auth');
    await expect(mod.checkoutPlans()).resolves.toEqual([
      expect.objectContaining({ priceId: 'price_real_builder' }),
      expect.objectContaining({ priceId: 'price_real_factory' }),
    ]);
  });
});

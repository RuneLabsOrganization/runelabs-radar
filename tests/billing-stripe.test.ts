import { describe, expect, it } from 'vitest';
import { tierFromStripeStatus } from '../src/lib/billing-stripe';

describe('tierFromStripeStatus', () => {
  it('keeps paid entitlements while Stripe status is active or trialing', () => {
    expect(tierFromStripeStatus('active')).toBe('keep-paid');
    expect(tierFromStripeStatus('trialing')).toBe('keep-paid');
  });

  it('sets free when the subscription is gone or unpaid', () => {
    expect(tierFromStripeStatus('canceled')).toBe('free');
    expect(tierFromStripeStatus('unpaid')).toBe('free');
    expect(tierFromStripeStatus('incomplete_expired')).toBe('free');
  });

  it('ignores other Stripe statuses so entitlements stay put', () => {
    expect(tierFromStripeStatus('past_due')).toBe('ignore');
    expect(tierFromStripeStatus('incomplete')).toBe('ignore');
    expect(tierFromStripeStatus('paused')).toBe('ignore');
  });
});

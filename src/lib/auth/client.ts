import { createAuthClient } from 'better-auth/react';
import { stripeClient } from '@better-auth/stripe/client';

export const authClient = createAuthClient({
  plugins: [stripeClient({ subscription: true })],
});

/** The Stripe subscription plugin's client surface (better-auth does not export its type). */
export interface SubscriptionApi {
  upgrade: (opts: {
    plan: string;
    annual?: boolean;
    successUrl: string;
    cancelUrl: string;
  }) => Promise<{ error?: { message?: string } }>;
  billingPortal: (opts: { returnUrl: string }) => Promise<{ error?: { message?: string } }>;
}

/**
 * Typed access to the subscription plugin — the one structural cast, so call
 * sites stay clean. Undefined when the plugin is absent (e.g. Stripe keys not
 * configured); callers fall back to signup/pricing redirects.
 */
export function subscriptionApi(): SubscriptionApi | undefined {
  return (authClient as { subscription?: SubscriptionApi }).subscription;
}

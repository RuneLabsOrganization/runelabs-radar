'use client';

import * as React from 'react';
import { paths } from '@/lib/urls';
import { TIER_PRICES, TIER_PRICES_ANNUAL } from '@/lib/billing-prices';
import { Button } from '@/components/ui/button';

export function CheckoutButtons({
  plan,
  annual = false,
}: {
  plan: 'builder' | 'factory';
  annual?: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const price = annual ? TIER_PRICES_ANNUAL[plan] : TIER_PRICES[plan];
  const suffix = annual ? '/yr' : '/mo';

  async function upgrade() {
    setError(null);
    let signedIn = false;
    try {
      const { authClient, subscriptionApi } = await import('@/lib/auth/client');
      const session = await authClient.getSession();
      signedIn = Boolean((session as { data?: unknown } | null)?.data);

      const subscription = subscriptionApi();
      if (subscription?.upgrade) {
        const result = await subscription.upgrade({
          plan,
          annual,
          successUrl: `${window.location.origin}${paths.account}?upgraded=1`,
          cancelUrl: `${window.location.origin}${paths.pricing}`,
        });
        if (!result?.error) return;
        if (signedIn) {
          setError(result.error.message ?? 'Checkout failed');
          return;
        }
      }
    } catch (e) {
      if (signedIn) {
        setError(e instanceof Error && e.message ? e.message : 'Checkout failed');
        return;
      }
    }

    if (signedIn) {
      setError('Checkout failed');
      return;
    }

    const interval = annual ? 'annual' : 'monthly';
    window.location.href = `${paths.signup}?plan=${plan}&interval=${interval}`;
  }

  const label = plan === 'builder' ? 'Builder' : 'Factory';
  return (
    <div className="w-full space-y-2">
      <Button className="w-full" onClick={() => void upgrade()}>
        Choose {label} · ${price}
        {suffix}
      </Button>
      {error && <p className="text-[12.5px] text-alert">{error}</p>}
    </div>
  );
}

'use client';

import { paths } from '@/lib/urls';
import { TIER_PRICES, TIER_PRICES_ANNUAL } from '@/lib/billing';
import { Button } from '@/components/ui/button';

export function CheckoutButtons({
  plan,
  annual = false,
}: {
  plan: 'builder' | 'factory';
  annual?: boolean;
}) {
  const price = annual ? TIER_PRICES_ANNUAL[plan] : TIER_PRICES[plan];
  const suffix = annual ? '/yr' : '/mo';

  async function upgrade() {
    try {
      const { authClient } = await import('@/lib/auth/client');
      const client = authClient as {
        subscription?: {
          upgrade: (opts: {
            plan: string;
            annual?: boolean;
            successUrl: string;
            cancelUrl: string;
          }) => Promise<{ error?: { message?: string } }>;
        };
      };
      if (client.subscription?.upgrade) {
        const result = await client.subscription.upgrade({
          plan,
          annual,
          successUrl: `${window.location.origin}${paths.account}?upgraded=1`,
          cancelUrl: `${window.location.origin}${paths.pricing}`,
        });
        if (!result?.error) return;
      }
    } catch {
      /* fall through */
    }
    const interval = annual ? 'annual' : 'monthly';
    window.location.href = `${paths.signup}?plan=${plan}&interval=${interval}`;
  }

  const label = plan === 'builder' ? 'Builder' : 'Factory';
  return (
    <Button className="w-full" onClick={() => void upgrade()}>
      Choose {label} · ${price}
      {suffix}
    </Button>
  );
}

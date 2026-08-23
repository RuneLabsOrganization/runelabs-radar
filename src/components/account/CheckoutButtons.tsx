'use client';

import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';

export function CheckoutButtons() {
  async function upgrade(plan: 'builder' | 'factory') {
    try {
      // Dynamic import keeps the stripe client optional
      const { authClient } = await import('@/lib/auth/client');
      const client = authClient as {
        subscription?: {
          upgrade: (opts: { plan: string; successUrl: string; cancelUrl: string }) => Promise<unknown>;
        };
      };
      if (client.subscription?.upgrade) {
        await client.subscription.upgrade({
          plan,
          successUrl: `${window.location.origin}${paths.account}?upgraded=1`,
          cancelUrl: `${window.location.origin}${paths.pricing}`,
        });
        return;
      }
    } catch {
      /* fall through */
    }
    window.location.href = `${paths.signup}?plan=${plan}`;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => upgrade('builder')}>
        Upgrade to Builder · $19
      </Button>
      <Button size="sm" variant="outline" onClick={() => upgrade('factory')}>
        Factory · $49
      </Button>
    </div>
  );
}

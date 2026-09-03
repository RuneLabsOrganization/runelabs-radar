'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { paths } from '@/lib/urls';

export function AutoCheckout() {
  const router = useRouter();
  const params = useSearchParams();
  const started = React.useRef(false);

  React.useEffect(() => {
    const checkout = params.get('checkout');
    if (checkout !== 'builder' && checkout !== 'factory') return;
    if (started.current) return;
    started.current = true;
    const annual = params.get('annual') === '1';

    void (async () => {
      try {
        const { subscriptionApi } = await import('@/lib/auth/client');
        const subscription = subscriptionApi();
        if (subscription?.upgrade) {
          const result = await subscription.upgrade({
            plan: checkout,
            annual,
            successUrl: `${window.location.origin}${paths.account}?upgraded=1`,
            cancelUrl: `${window.location.origin}${paths.pricing}`,
          });
          if (!result?.error) return;
        }
      } catch {
        /* still strip the query so we do not loop */
      }
      router.replace(paths.account);
    })();
  }, [params, router]);

  return null;
}

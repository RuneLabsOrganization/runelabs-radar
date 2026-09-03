'use client';

import * as React from 'react';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { subscriptionApi } from '@/lib/auth/client';

export function BillingPortalButton() {
  const [error, setError] = React.useState<string | null>(null);

  async function open() {
    setError(null);
    const subscription = subscriptionApi();
    if (subscription?.billingPortal) {
      try {
        const result = await subscription.billingPortal({
          returnUrl: `${window.location.origin}${paths.account}`,
        });
        if (result?.error) {
          setError(result.error.message ?? 'Could not open billing portal');
        }
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : 'Could not open billing portal');
      }
      return;
    }
    window.location.href = paths.pricing;
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => void open()}>
        Manage billing
      </Button>
      {error && <p className="text-[12.5px] text-alert">{error}</p>}
    </div>
  );
}

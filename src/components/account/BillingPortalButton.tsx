'use client';

import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';

export function BillingPortalButton() {
  async function open() {
    const client = authClient as {
      subscription?: {
        billingPortal: (opts: { returnUrl: string }) => Promise<unknown>;
      };
    };
    if (client.subscription?.billingPortal) {
      await client.subscription.billingPortal({
        returnUrl: `${window.location.origin}${paths.account}`,
      });
      return;
    }
    window.location.href = paths.pricing;
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void open()}>
      Manage billing
    </Button>
  );
}

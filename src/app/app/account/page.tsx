import Link from 'next/link';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth/user';
import { entitlementFor, usageThisCycle, TIER_PRICES, quotaFor } from '@/lib/billing';
import { can, TIER_CAPS } from '@/lib/entitlements';
import { economyThisCycle, economyLifetimeSaved } from '@/lib/mcp-economy';
import { siteMeta } from '@/lib/seo';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { SectionHeader } from '@/components/ui/section-header';
import { AutoCheckout } from '@/components/account/AutoCheckout';
import { BillingPortalButton } from '@/components/account/BillingPortalButton';
import { CheckoutButtons } from '@/components/account/CheckoutButtons';
import PageHeader from '@/components/PageHeader';

export const metadata = siteMeta('Account', 'Your Radar account and billing.', paths.account, {
  index: false,
});

export default async function AccountPage() {
  const user = await requireUser();
  const ent = entitlementFor(user.id);
  const used = usageThisCycle(user.id);
  const planGate = can(user, 'plan');
  const debateGate = can(user, 'debate');
  const askGate = can(user, 'ask');
  const eco = economyThisCycle(user.id);
  const lifetime = economyLifetimeSaved(user.id);
  const caps = TIER_CAPS[ent.tier];

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader
        kicker="Account"
        title={user.name}
        description={user.email ?? 'Legacy operator account'}
      />

      <SectionHeader label="plan" />
      <Card>
        <CardHeader>
          <CardTitle className="capitalize">{ent.tier}</CardTitle>
          <CardDescription>
            ${TIER_PRICES[ent.tier]}/mo · {quotaFor(ent.tier)} plans / month
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1 flex justify-between font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
              <span>Plans this cycle</span>
              <span>
                {used} / {ent.plansPerMonth}
              </span>
            </div>
            <Meter value={used} max={ent.plansPerMonth || 1} />
          </div>
          <div className="grid gap-2 text-[12.5px] text-ink-3 sm:grid-cols-2">
            <div>
              Debates:{' '}
              <span className="text-ink-2">
                {debateGate.quota == null || caps.debatesPerMonth < 0
                  ? 'unlimited'
                  : `${debateGate.used ?? 0} / ${debateGate.quota}`}
              </span>
            </div>
            <div>
              ask_radar:{' '}
              <span className="text-ink-2">
                {caps.asksPerMonth < 0 ? 'unlimited' : `${askGate.used ?? 0} / ${askGate.quota ?? caps.asksPerMonth}`}
              </span>
            </div>
            <div>
              Plan gate:{' '}
              <span className={planGate.ok ? 'text-phosphor' : 'text-amber'}>
                {planGate.ok ? 'open' : planGate.reason}
              </span>
            </div>
          </div>
          {ent.tier === 'free' && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <CheckoutButtons plan="builder" />
              <CheckoutButtons plan="factory" />
            </div>
          )}
          {ent.tier !== 'free' && <BillingPortalButton />}
          <Suspense fallback={null}>
            <AutoCheckout />
          </Suspense>
        </CardContent>
      </Card>

      <SectionHeader label="tokens Radar saved" />
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">This cycle</CardTitle>
          <CardDescription>
            Conservative estimate of tokens kept out of your coding agent via compact MCP replies and server-side
            research. Methodology on{' '}
            <Link href={paths.pricing} className="text-phosphor hover:underline">
              /pricing
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-[12.5px] text-ink-3 sm:grid-cols-2">
          <div>
            Calls metered:{' '}
            <span className="mono text-ink-2">{eco.calls.toLocaleString()}</span>
          </div>
          <div>
            Saved vs DIY:{' '}
            <span className="mono text-phosphor">~{eco.tokens_saved_vs_diy.toLocaleString()}</span>
          </div>
          <div>
            Saved vs full dumps:{' '}
            <span className="mono text-ink-2">~{eco.tokens_saved_vs_full.toLocaleString()}</span>
          </div>
          <div>
            Lifetime vs DIY:{' '}
            <span className="mono text-ink-2">~{lifetime.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      <SectionHeader label="quick links" />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={paths.connect}>Connect MCP</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={paths.batches}>My batches</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={paths.opportunities}>Opportunities</Link>
        </Button>
      </div>
    </div>
  );
}

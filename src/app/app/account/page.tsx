import Link from 'next/link';
import { requireUser } from '@/lib/auth/user';
import { entitlementFor, usageThisCycle, TIER_PRICES, quotaFor } from '@/lib/billing';
import { can } from '@/lib/entitlements';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { SectionHeader } from '@/components/ui/section-header';
import { CheckoutButtons } from '@/components/account/CheckoutButtons';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const user = await requireUser();
  const ent = entitlementFor(user.id);
  const used = usageThisCycle(user.id);
  const planGate = can(user, 'plan');
  const debateGate = can(user, 'debate');

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="readout text-phosphor">Account</div>
      <h1 className="type-h1 mt-1">{user.name}</h1>
      <p className="mt-1 text-[13px] text-ink-3">{user.email ?? 'Legacy operator account'}</p>

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
                {debateGate.quota == null || debateGate.quota < 0
                  ? 'unlimited'
                  : `${debateGate.used ?? 0} / ${debateGate.quota}`}
              </span>
            </div>
            <div>
              Plan gate:{' '}
              <span className={planGate.ok ? 'text-phosphor' : 'text-amber'}>
                {planGate.ok ? 'open' : planGate.reason}
              </span>
            </div>
          </div>
          {ent.tier === 'free' && <CheckoutButtons />}
          {ent.tier !== 'free' && (
            <Button asChild variant="outline" size="sm">
              <Link href={paths.pricing}>Manage billing</Link>
            </Button>
          )}
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

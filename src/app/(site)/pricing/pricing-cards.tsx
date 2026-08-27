'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { TIER_PRICES, TIER_PRICES_ANNUAL, quotaFor, type Tier } from '@/lib/billing-prices';
import { TIER_CAPS } from '@/lib/entitlements-caps';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckoutButtons } from '@/components/account/CheckoutButtons';

/**
 * Tiers sell outcomes, not units. A visitor cannot value "30 debates/month"
 * because nothing has told them what a debate gives them — so every line is
 * phrased as what you get to do, with the number as supporting detail.
 */
const TIERS: { tier: Tier; who: string; blurb: string; highlights: string[] }[] = [
  {
    tier: 'free',
    who: 'Anyone tired of guessing',
    blurb: 'Every verdict, every setup, every brief. No limits, no card.',
    highlights: [
      'What to use for every job — unlimited',
      'What changed, every day you show up',
      `Ask us ${TIER_CAPS.free.asksPerMonth} real questions a month`,
      `Turn ${quotaFor('free')} ideas a month into a full plan`,
      'One project workspace',
    ],
  },
  {
    tier: 'builder',
    who: 'You ship something most months',
    blurb: 'Everything free, plus Radar doing the work instead of just answering.',
    highlights: [
      'Ask as much as you want, effectively',
      `Turn ${quotaFor('builder')} ideas a month into full plans`,
      'Pressure-test any idea from four sides — unlimited',
      'Radar learns what you build and filters to it',
      `Run ${TIER_CAPS.builder.workspaceBatches} projects side by side`,
    ],
  },
  {
    tier: 'factory',
    who: 'You ship constantly, or for clients',
    blurb: 'Uncapped, and first in line when you are in a hurry.',
    highlights: [
      'Nothing metered but plans',
      `Turn ${quotaFor('factory')} ideas a month into full plans`,
      'Priority when the queue is busy',
      'Watch the things you care about, get told when they move',
      'Everything Builder has, at Factory quotas',
    ],
  },
];

function priceFor(tier: Tier, annual: boolean): { amount: number; suffix: string } {
  if (tier === 'free') return { amount: 0, suffix: '/mo' };
  if (annual) return { amount: TIER_PRICES_ANNUAL[tier], suffix: '/yr' };
  return { amount: TIER_PRICES[tier], suffix: '/mo' };
}

export function PricingCards() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex border border-line bg-panel"
        >
          <button
            type="button"
            className={`readout px-3 py-1.5 ${!annual ? 'bg-phosphor/15 text-phosphor' : 'text-ink-3 hover:text-ink'}`}
            aria-pressed={!annual}
            onClick={() => setAnnual(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`readout px-3 py-1.5 ${annual ? 'bg-phosphor/15 text-phosphor' : 'text-ink-3 hover:text-ink'}`}
            aria-pressed={annual}
            onClick={() => setAnnual(true)}
          >
            Annual
          </button>
        </div>
        {annual && <span className="readout text-phosphor">Two months free</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {TIERS.map(({ tier, who, blurb, highlights }) => {
          const { amount, suffix } = priceFor(tier, annual);
          return (
            <Card key={tier} className={tier === 'builder' ? 'border-phosphor/40 shadow-glow' : undefined}>
              <CardHeader>
                <div className="readout capitalize text-phosphor">{tier}</div>
                <CardTitle className="mt-2 flex items-baseline gap-1">
                  <span className="text-[28px] font-semibold tracking-tight">${amount}</span>
                  <span className="mono text-[10.5px] uppercase text-ink-4">{suffix}</span>
                </CardTitle>
                <p className="mt-1 text-[12px] font-medium text-ink">{who}</p>
                <CardDescription className="mt-1">{blurb}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-phosphor" />
                      {h}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {tier === 'free' ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href={paths.signup}>Start free</Link>
                  </Button>
                ) : (
                  <CheckoutButtons plan={tier} annual={annual} />
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

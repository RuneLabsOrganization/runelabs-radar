import Link from 'next/link';
import { Check } from 'lucide-react';
import { TIER_PRICES, quotaFor, type Tier } from '@/lib/billing';
import { TIER_CAPS } from '@/lib/entitlements';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { CheckoutButtons } from '@/components/account/CheckoutButtons';

export const metadata = {
  title: 'Pricing',
  description:
    'Everything you need to decide what to use is free, forever. You pay when you want Radar producing work for you — plans, arguments, research. Builder $19 · Factory $49.',
};

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
      'Team seats (coming)',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-12 sm:px-6">
      <div className="readout text-phosphor">Hosted · radar.runelabs.org</div>
      <h1 className="type-h1 mt-2 max-w-2xl text-balance">
        You already pay for the tools. This is the part that tells you which ones.
      </h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-2">
        Everything you need to <em>decide</em> is free, forever — every verdict, every setup, every brief. You pay
        when you want Radar producing work for you: plans, arguments, research you would otherwise do yourself.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TIERS.map(({ tier, who, blurb, highlights }) => (
          <Card key={tier} className={tier === 'builder' ? 'border-phosphor/40 shadow-glow' : undefined}>
            <CardHeader>
              <div className="readout capitalize text-phosphor">{tier}</div>
              <CardTitle className="mt-2 flex items-baseline gap-1">
                <span className="text-[28px] font-semibold tracking-tight">${TIER_PRICES[tier]}</span>
                <span className="mono text-[10.5px] uppercase text-ink-4">/mo</span>
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
              ) : tier === 'builder' ? (
                <div className="w-full">
                  <CheckoutButtons />
                </div>
              ) : (
                <Button asChild className="w-full">
                  <Link href={paths.account}>Choose Factory</Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      <SectionHeader label="what you get for $19" />
      <Card>
        <CardContent className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-2">
          <p>
            <span className="text-ink">A plan</span> is the whole life of an idea in one document — is this worth
            doing, what to build first, how to launch it, how it makes money — grounded in what is actually happening
            in the market this week, not in a template.
          </p>
          <p>
            <span className="text-ink">A debate</span> is four roles arguing about your idea before you spend a month
            on it. One of them is trying to kill it.
          </p>
          <p className="text-ink-3">
            Re-reading a plan you already made is always free. Cancel any time; nothing you have made goes away.
          </p>
        </CardContent>
      </Card>

      <SectionHeader label="the honest caveats" />
      <Card>
        <CardContent className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-2">
          <p>
            <span className="text-ink">Nobody pays us to recommend anything.</span> No affiliate links, no
            sponsorships, no vendor money. If a verdict changes it is because the evidence changed.
          </p>
          <p>
            <span className="text-ink">We under-claim on purpose.</span> Every figure we publish is rounded down from
            a seeded benchmark rather than up from a good day.{' '}
            <Link href={paths.trust} className="text-phosphor hover:underline">
              Here is exactly how we measure it
            </Link>
            .
          </p>
          <p>
            <span className="text-ink">You can run the whole thing yourself.</span> Source-available under BSL 1.1 —
            same pipeline, same tools, no quotas, on your own hardware. These prices are for the hosted service.{' '}
            <a
              href="https://github.com/RuneLabsOrganization/runelabs-radar"
              className="text-phosphor hover:underline"
              rel="noreferrer"
            >
              README
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

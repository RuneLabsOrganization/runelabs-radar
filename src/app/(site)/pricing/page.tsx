import Link from 'next/link';
import { paths } from '@/lib/urls';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { PricingCards } from './pricing-cards';

export const metadata = {
  title: 'Pricing',
  description:
    'Everything you need to decide what to use is free, forever. You pay when you want Radar producing work for you — plans, arguments, research. Builder $19 · Factory $49.',
};

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

      <PricingCards />

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

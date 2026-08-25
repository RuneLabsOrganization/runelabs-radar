import Link from 'next/link';
import { Check } from 'lucide-react';
import { TIER_PRICES, quotaFor, type Tier } from '@/lib/billing';
import { TIER_CAPS } from '@/lib/entitlements';
import { PUBLISHED_SAVINGS, fmtTokens } from '@/lib/mcp-savings-copy';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { CheckoutButtons } from '@/components/account/CheckoutButtons';

export const metadata = {
  title: 'Pricing',
  description:
    'Artifact pricing: free compact reads, pay for plans, debates, asks, and batches. Radar spends its tokens so your coding agent does not — ~8k DIY tokens saved per compact lookup. Builder $19 · Factory $49.',
};

const TIERS: { tier: Tier; blurb: string; highlights: string[] }[] = [
  {
    tier: 'free',
    blurb: 'Browse everything compact. Try ask_radar and the opportunity → plan flow.',
    highlights: [
      'Unlimited compact reads',
      `${quotaFor('free')} plans / month`,
      `${TIER_CAPS.free.debatesPerMonth} debates / month`,
      `${TIER_CAPS.free.asksPerMonth} ask_radar / month`,
      '1 workspace batch',
    ],
  },
  {
    tier: 'builder',
    blurb: 'Indie founders shipping monthly — debates unlimited, synthesis + personalization.',
    highlights: [
      `${quotaFor('builder')} plans / month`,
      'Unlimited debates',
      `${TIER_CAPS.builder.asksPerMonth} ask_radar / month`,
      `${TIER_CAPS.builder.workspaceBatches} workspace batches`,
      'Bulk debate & plan runs',
      'Personalization + watchlists',
    ],
  },
  {
    tier: 'factory',
    blurb: 'Small teams and serial builders — research feels limitless; plan quota remains.',
    highlights: [
      `${quotaFor('factory')} plans / month`,
      'Unlimited debates, asks & batches',
      'Priority plan queue',
      'Watchlists + get_since deltas',
      'Team-ready seats (coming)',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-12 sm:px-6">
      <div className="readout text-phosphor">Hosted · radar.runelabs.org</div>
      <h1 className="type-h1 mt-2">Pricing</h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-2">
        Your unit is a plan, a debate, an ask, or a batch run — not a token. Compact reads are free and unlimited.
        A typical lookup returns ~{PUBLISHED_SAVINGS.compactAvgReturned} tokens and keeps ~
        {fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)} out of your coding agent vs researching locally. Quota
        meters generative actions only.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TIERS.map(({ tier, blurb, highlights }) => (
          <Card key={tier} className={tier === 'builder' ? 'border-phosphor/40 shadow-glow' : undefined}>
            <CardHeader>
              <div className="readout capitalize text-phosphor">{tier}</div>
              <CardTitle className="mt-2 flex items-baseline gap-1">
                <span className="text-[28px] font-semibold tracking-tight">${TIER_PRICES[tier]}</span>
                <span className="mono text-[10.5px] uppercase text-ink-4">/mo</span>
              </CardTitle>
              <CardDescription>{blurb}</CardDescription>
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

      <SectionHeader label="what's a plan" />
      <Card>
        <CardContent className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-2">
          <p>
            One plan is a full-lifecycle execution plan from <span className="mono text-ink">generate_plan</span> —
            validation → build → launch → GTM → revenue — grounded in live signals, pains, comps, and market prices.
          </p>
          <p className="text-ink-3">
            Cached plans never consume quota. Debates, ask_radar, and batch bulk-runs are metered separately by tier.
            generate_plan returns markdown or JSON — not both — about {PUBLISHED_SAVINGS.planVsDualPct}% smaller than
            dumping the old dual payload (~{fmtTokens(PUBLISHED_SAVINGS.planDiySaved)} DIY tokens saved per plan).
          </p>
        </CardContent>
      </Card>

      <SectionHeader label="token-savings methodology" />
      <Card>
        <CardContent className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-2">
          <p>
            The <span className="mono text-ink">economy</span> field on MCP responses is an ROI receipt, not a bill.
            We estimate tokens as UTF-8 chars ÷ 4. Figures below are rounded <em>down</em> from a seeded bench (
            <span className="mono">tests/mcp-savings-bench.test.ts</span>) so we under-claim.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink-3">
            <li>
              <span className="text-ink-2">returned</span> — what your agent actually ingested. Compact lookups
              average ~{PUBLISHED_SAVINGS.compactAvgReturned} tokens.
            </li>
            <li>
              <span className="text-ink-2">saved_vs_full</span> — vs shipping the old pretty-printed JSON dump of
              the same data (~{PUBLISHED_SAVINGS.compactAvgSavedVsFull} tokens on a typical compact call; weekly
              compact is ~{PUBLISHED_SAVINGS.weeklyFullVsCompact}× smaller than the full issue)
            </li>
            <li>
              <span className="text-ink-2">saved_vs_diy</span> — vs your agent researching locally. Compact lookup
              ~{fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)}; ask_radar ~
              {fmtTokens(PUBLISHED_SAVINGS.askDiySaved)}; plan ~{fmtTokens(PUBLISHED_SAVINGS.planDiySaved)}. A
              research-to-plan session ~{fmtTokens(PUBLISHED_SAVINGS.sessionDiySaved)}.
            </li>
          </ul>
          <p className="text-ink-3">
            Call <span className="mono text-ink">get_my_usage</span> from your agent for this-cycle totals. We
            deliberately under-claim rather than inflate.
          </p>
        </CardContent>
      </Card>

      <SectionHeader label="self-hosting" />
      <Card>
        <CardContent className="p-5 text-[13px] text-ink-2">
          Source-available (BSL 1.1), fully capable on your hardware — same pipeline, same tools, no quotas. These
          prices apply to the hosted service only.{' '}
          <a
            href="https://github.com/RuneLabsOrganization/runelabs-radar"
            className="text-phosphor hover:underline"
            rel="noreferrer"
          >
            README
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

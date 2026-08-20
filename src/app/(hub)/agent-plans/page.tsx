import { AGENT_PLANS } from '@/lib/agent-plans';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';

export const metadata = {
  title: 'Coding-agent plans — which subscription is worth it',
  description:
    'The coding-agent subscription landscape compared: Cursor, Claude Code, Codex, Copilot, Windsurf, Kimi Code and friends — list price, the limit that actually bites, and a one-line verdict. Manually reviewed quarterly; price history accumulates in our metric store.',
};

/** Cheapest first; within a price, the vendor order the table was seeded in. */
const PLANS = [...AGENT_PLANS].sort((a, b) => a.priceUsdMo - b.priceUsdMo);

/**
 * The comparison our audience asks for in every inbox week: "which agent
 * plan is worth it." Rendered straight from the AGENT_PLANS const — always
 * current, no DB dependency. The weekly syncAgentPlans job logs each price
 * into metric_points (source 'agent-plans') so changes accumulate into a
 * first-party price series.
 */
export default function AgentPlansPage() {
  const free = PLANS.filter((p) => p.priceUsdMo === 0).length;
  const cheapest = PLANS.find((p) => p.priceUsdMo > 0);

  return (
    <main className="mx-auto max-w-[860px] px-6 py-7">
      <PageHeader
        kicker="which agent plan is worth it"
        title="Coding-agent plans"
        description="List prices and headline limits for the coding-agent subscriptions builders actually ask us about — IDE agents, CLI agents, and the platform add-ons. Hand-maintained and reviewed quarterly (last review: 2026-08); a weekly job logs every price into our metric store, so the history accumulates."
      />
      <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
        {PLANS.length} plans tracked &middot; {free} free &middot; cheapest paid seat $
        {cheapest?.priceUsdMo ?? '—'}/mo &middot; prices in USD
      </p>

      <SectionHeader label="the landscape" count={PLANS.length} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th className="text-right">$/mo</th>
              <th>The limit that bites</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {PLANS.map((p) => (
              <tr key={`${p.vendor} ${p.name}`}>
                <td className="whitespace-nowrap">
                  <span style={{ color: 'var(--ink)' }}>{p.vendor}</span>{' '}
                  <span style={{ color: 'var(--ink-3)' }}>{p.name}</span>
                </td>
                <td className="mono text-right text-[11.5px]">
                  {p.priceUsdMo === 0 ? (
                    <span style={{ color: 'var(--phosphor)' }}>free</span>
                  ) : (
                    `$${p.priceUsdMo}`
                  )}
                </td>
                <td className="mono text-[10.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {p.limits}
                </td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {p.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        sorted cheapest first &middot; list prices, annual-commit headline where that&rsquo;s the advertised rate
      </p>

      <SectionHeader label="how to read this" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Every plan on this page is &ldquo;unlimited&rdquo; in the marketing copy and throttled in practice — so
          the limits column carries the number that actually bites: the fast-request budget, the credit pool, the
          5-hour message window. Verdicts are editorial, from running these agents on this platform&rsquo;s own
          build. No vendor pays for placement — on this page or anywhere else on the radar.
        </p>
        <p className="mt-3 border-t border-[var(--grat-soft)] pt-2.5 text-[12px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          The $20 tier is the industry&rsquo;s center of gravity — Cursor Pro, Claude Code Pro and Codex-via-Plus
          all land there, and for most builders one of them is the whole answer. The $200 tiers only make sense
          when an agent is your primary builder, several hours a day.
        </p>
      </div>

      <SectionHeader label="how we track it" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          This table is seeded by hand and re-reviewed every quarter — plan pricing changes too quietly to trust
          a scraper with it. A weekly job writes each plan&rsquo;s price into our metric store (
          <span className="mono text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
            metric_points · source &lsquo;agent-plans&rsquo; · price_usd_mo
          </span>
          ), so when a vendor moves a price or a tier, the change lands in a first-party time series instead of
          vanishing into a changelog nobody reads.
        </p>
      </div>

      <div className="mt-9 border-t border-[var(--grat-soft)] pt-3">
        <p className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
          last manual review 2026-08 &middot; reviewed quarterly &middot; no pay-for-placement
        </p>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { AGENT_STACKS_REVIEWED_AT, costBand } from '@/lib/agent-stacks';
import { publishedAgentStacks } from '@/lib/agent-stacks-sync';
import { AGENT_PLANS } from '@/lib/agent-plans';
import { timeAgo } from '@/lib/feed';
import { paths } from '@/lib/urls';
import SectionHeader from '@/components/SectionHeader';
import PageHeader from '@/components/PageHeader';
import { AgentsTabs } from './AgentsTabs';

export const metadata = {
  title: 'Agents — stacks & subscription plans',
  description:
    'Which IDE + harness + model to run, and which coding-agent subscription is worth it — survey love-rates, mention heat, list prices, and editorial verdicts.',
};

/** Cheapest first; within a price, the vendor order the table was seeded in. */
const PLANS = [...AGENT_PLANS].sort((a, b) => a.priceUsdMo - b.priceUsdMo);

/**
 * Combined agent stacks (IDE + harness + model) and subscription plans.
 * Formerly /agent-stacks and /agent-plans; both redirect here.
 */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const defaultTab = tab === 'plans' ? 'plans' : 'stacks';

  const pub = publishedAgentStacks();
  const { personas, landscape, pairings, defaultAppStack } = pub;
  const lovedTotal = landscape.reduce((s, h) => s + h.lovedPct, 0);

  const free = PLANS.filter((p) => p.priceUsdMo === 0).length;
  const cheapest = PLANS.find((p) => p.priceUsdMo > 0);

  const stacks = (
    <>
      <h2 className="type-h2">Agent stacks</h2>
      <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">
        What people who code all day are actually running, and what they pay in practice rather than on the pricing
        page. Ranked from survey data and user reports, not from vendor claims. Find the row that sounds like you,
        copy the setup, stop reading.
      </p>
      <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.06em] text-ink-4">
        {personas.length} personas &middot; {landscape.length} harnesses &middot; loved % sums to {lovedTotal}{' '}
        &middot; last review {AGENT_STACKS_REVIEWED_AT}
        {pub.refreshedAt ? (
          <>
            {' '}
            &middot; refresh {timeAgo(pub.refreshedAt)}
            {pub.braveHits > 0 ? ` · ${pub.braveHits} brave hits` : ''}
          </>
        ) : (
          <> &middot; mentions live 7-day</>
        )}
      </p>

      <SectionHeader label="who should use what" count={personas.length} />
      <table className="table table-cards">
        <thead>
          <tr>
            <th>You are</th>
            <th>Run this</th>
            <th className="num">Typical $</th>
            <th>Skip</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((p) => (
            <tr key={p.slug} id={p.slug}>
              <td data-label="you are" className="whitespace-nowrap">
                <span className="text-ink">{p.label}</span>
              </td>
              <td data-label="run this" className="text-[11.5px] leading-snug text-ink-2">
                {p.stack}
              </td>
              <td data-label="typical $" className="num mono whitespace-nowrap text-[11.5px]">{costBand(p)}</td>
              <td data-label="skip" className="text-[11.5px] leading-snug text-ink-3">
                {p.skip}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono mt-2 text-[10px] text-ink-4">
        typical spend, not sticker &middot; seat prices live on the Plans tab
      </p>

      <SectionHeader label="why — the short version" />
      <div className="flex flex-col gap-3">
        {personas.map((p) => (
          <div key={p.slug} className="card !p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="readout text-phosphor">
                &#9646; {p.label}
              </span>
              <span className="mono text-[10.5px] text-ink-4">
                {p.ide} · {p.harness} · {p.model}
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
              {p.why}
            </p>
          </div>
        ))}
      </div>

      <SectionHeader label="what developers actually love" count={landscape.length} />
      <table className="table table-cards">
        <thead>
          <tr>
            <th>Harness</th>
            <th>Kind</th>
            <th className="num">Loved %</th>
            <th className="num">7d mentions</th>
            <th>Kept for</th>
            <th>Loses</th>
          </tr>
        </thead>
        <tbody>
          {landscape.map((h) => (
            <tr key={h.name}>
              <td data-label="harness" className="whitespace-nowrap text-ink">
                {h.name}
                {h.lovedSource === 'remainder' && (
                  <span className="ml-1 text-ink-4">
                    *
                  </span>
                )}
              </td>
              <td data-label="kind" className="mono text-[10.5px] uppercase text-ink-4">
                {h.kind}
              </td>
              <td data-label="loved %" className="num mono text-[11.5px]">{h.lovedPct}%</td>
              <td data-label="7d mentions" className="num mono text-[11.5px]">
                {h.mentions7d > 0 ? h.mentions7d : <span className="text-ink-4">—</span>}
              </td>
              <td data-label="kept for" className="text-[11.5px] leading-snug text-ink-3">
                {h.role}
              </td>
              <td data-label="loses" className="text-[11.5px] leading-snug text-ink-3">
                {h.loses}
              </td>
            </tr>
          ))}
          <tr>
            <td data-label="harness" className="mono text-[10.5px] uppercase text-ink-4">
              total
            </td>
            <td data-label="kind" />
            <td data-label="loved %" className="num mono text-[11.5px] text-phosphor">
              {lovedTotal}%
            </td>
            <td data-label="7d mentions" />
            <td data-label="kept for" colSpan={2} className="mono text-[10px] text-ink-4">
              single-choice favorite · closes to 100
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mono mt-2 text-[10px] text-ink-4">
        loved % = Pragmatic Engineer Feb 2026, n=906, single-choice favorite — not install base. 46 / 19 / 9
        are the published top three; * rows split the unpublished 26% remainder from PE usage rank (Codex) and
        named other-loved tools (OpenCode, Windsurf, long tail). Rest of field absorbs rounding.
        &middot; 7d mentions = curated stories in this radar that name the harness — live, not the quarterly review
      </p>

      <SectionHeader label="model + harness pairing" count={pairings.length} />
      <table className="table table-cards">
        <thead>
          <tr>
            <th>Job</th>
            <th>Model people reach for</th>
            <th>Where they run it</th>
          </tr>
        </thead>
        <tbody>
          {pairings.map((row) => (
            <tr key={row.job}>
              <td data-label="job" className="text-[11.5px] leading-snug">{row.job}</td>
              <td data-label="model people reach for" className="text-[11.5px] leading-snug text-ink-2">
                {row.model}
              </td>
              <td data-label="where they run it" className="text-[11.5px] leading-snug text-ink-3">
                {row.harness}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono mt-2 text-[10px] text-ink-4">
        native harness + native model &middot; mixing frontier models inside Cursor is the expensive path
      </p>

      <SectionHeader label="the app stack models already know" />
      <div className="card !p-4">
        <p className="text-[13px] font-medium">{defaultAppStack.title}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          {defaultAppStack.note} Per-venture layers (auth, payments, hosting) live on{' '}
          <Link href={paths.stacks} className="underline-offset-2 hover:underline text-ink-2">
            Stacks
          </Link>
          .
        </p>
      </div>

      <SectionHeader label="how we track it" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          Two clocks. Mention heat is live from the story graph (same ingest as Today). A daily job (04:45 UTC)
          searches Brave (news + web, past day) for the coding-agent landscape, then one MiniMax call — tagged{' '}
          <span className="mono text-[11.5px] text-ink-2">
            job &lsquo;agent-stacks&rsquo; · feature &lsquo;agent-stacks&rsquo;
          </span>{' '}
          so the cost lands in admin — may refresh copy and cost bands. Loved % is not free to hallucinate: PE
          published Claude Code 46 / Cursor 19 / Copilot 9 stay locked; the unpublished 26% remainder still
          closes to 100. Snapshots go to{' '}
          <span className="mono text-[11.5px] text-ink-2">
            metric_points · source &lsquo;agent-stacks&rsquo;
          </span>
          .
        </p>
        {pub.rationale && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            Latest refresh: {pub.rationale}
          </p>
        )}
        <p className="mt-3 border-t border-grat-soft pt-2.5 text-[12px] leading-relaxed text-ink-4">
          Agents: <span className="mono">list_agent_stacks</span> then{' '}
          <span className="mono">get_agent_stack_for</span>. Seat prices: Plans tab. Product playbooks:{' '}
          <Link href={paths.stacks} className="underline-offset-2 hover:underline">
            Stacks
          </Link>
          .
        </p>
      </div>

      <div className="mt-9 border-t border-grat-soft pt-3">
        <p className="mono text-[10px] text-ink-4">
          last manual review {AGENT_STACKS_REVIEWED_AT} &middot; reviewed quarterly &middot; no pay-for-placement
        </p>
      </div>
    </>
  );

  const plans = (
    <>
      <h2 className="type-h2">Coding-agent plans</h2>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
        List prices and headline limits for the coding-agent subscriptions builders actually ask us about — IDE
        agents, CLI agents, and the platform add-ons. Hand-maintained and reviewed quarterly (last review: 2026-08);
        a weekly job logs every price into our metric store, so the history accumulates. Which IDE + harness + model
        to actually run lives on the Stacks tab.
      </p>
      <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.06em] text-ink-4">
        {PLANS.length} plans tracked &middot; {free} free &middot; cheapest paid seat $
        {cheapest?.priceUsdMo ?? '—'}/mo &middot; prices in USD
      </p>

      <SectionHeader label="the landscape" count={PLANS.length} />
      <table className="table table-cards">
        <thead>
          <tr>
            <th>Plan</th>
            <th className="num">$/mo</th>
            <th>The limit that bites</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {PLANS.map((p) => (
            <tr key={`${p.vendor} ${p.name}`}>
              <td data-label="plan" className="whitespace-nowrap">
                <span className="text-ink">{p.vendor}</span>{' '}
                <span className="text-ink-3">{p.name}</span>
              </td>
              <td data-label="$/mo" className="num mono text-[11.5px]">
                {p.priceUsdMo === 0 ? (
                  <span className="text-phosphor">free</span>
                ) : (
                  `$${p.priceUsdMo}`
                )}
              </td>
              <td data-label="the limit that bites" className="mono text-[10.5px] leading-snug text-ink-3">
                {p.limits}
              </td>
              <td data-label="verdict" className="text-[11.5px] leading-snug text-ink-3">
                {p.verdict}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono mt-2 text-[10px] text-ink-4">
        sorted cheapest first &middot; list prices, annual-commit headline where that&rsquo;s the advertised rate
      </p>

      <SectionHeader label="how to read this" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          Every plan on this page is &ldquo;unlimited&rdquo; in the marketing copy and throttled in practice — so
          the limits column carries the number that actually bites: the fast-request budget, the credit pool, the
          5-hour message window. Verdicts are editorial, from running these agents on this platform&rsquo;s own
          build. No vendor pays for placement — on this page or anywhere else on the radar.
        </p>
        <p className="mt-3 border-t border-grat-soft pt-2.5 text-[12px] leading-relaxed text-ink-4">
          The $20 tier is the industry&rsquo;s center of gravity — Cursor Pro, Claude Code Pro and Codex-via-Plus
          all land there, and for most builders one of them is the whole answer. The $200 tiers only make sense
          when an agent is your primary builder, several hours a day.
        </p>
      </div>

      <SectionHeader label="how we track it" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          This table is seeded by hand and re-reviewed every quarter — plan pricing changes too quietly to trust
          a scraper with it. A weekly job writes each plan&rsquo;s price into our metric store (
          <span className="mono text-[11.5px] text-ink-2">
            metric_points · source &lsquo;agent-plans&rsquo; · price_usd_mo
          </span>
          ), so when a vendor moves a price or a tier, the change lands in a first-party time series instead of
          vanishing into a changelog nobody reads.
        </p>
      </div>

      <div className="mt-9 border-t border-grat-soft pt-3">
        <p className="mono text-[10px] text-ink-4">
          last manual review 2026-08 &middot; reviewed quarterly &middot; no pay-for-placement
        </p>
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        kicker="Decide · Agents"
        title="Agents"
        description="What people who code all day are actually running, what it costs them in practice, and which subscription plan stops hurting first. Two views: the stacks people run, and the plans they run them on."
      />
      <AgentsTabs stacks={stacks} plans={plans} defaultTab={defaultTab} />
    </div>
  );
}

import Link from 'next/link';
import {
  AGENT_PERSONAS,
  AGENT_STACKS_REVIEWED_AT,
  DEFAULT_APP_STACK,
  HARNESS_LANDSCAPE,
  MODEL_PAIRINGS,
  costBand,
  landscapeWithMentions,
} from '@/lib/agent-stacks';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';

export const metadata = {
  title: 'Agent stacks — which IDE + harness + model to run',
  description:
    'The coding-agent stack builders actually keep: IDE, harness, and model pairings by persona, with survey love-rates, first-party mention heat, and real monthly spend — not just list prices.',
};

/**
 * Sibling of /agent-plans (seat prices) and /stacks (venture playbooks).
 * Editorial table is the const; 7-day mention heat is live from the story graph.
 */
export default function AgentStacksPage() {
  const landscape = landscapeWithMentions(HARNESS_LANDSCAPE);

  return (
    <main className="mx-auto max-w-[860px] px-6 py-7">
      <PageHeader
        kicker="ide · harness · model — not the product stack"
        title="Agent stacks"
        description="Which editor, agent harness, and model builders actually run — ranked from survey love-rates and user-report cost, with this week’s mention heat from our own feed. Distinct from venture playbooks on Stacks and from seat prices on Agent Plans."
      />
      <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
        {AGENT_PERSONAS.length} personas &middot; {HARNESS_LANDSCAPE.length} harnesses &middot; last review{' '}
        {AGENT_STACKS_REVIEWED_AT} &middot; mentions are live 7-day
      </p>

      <SectionHeader label="who should use what" count={AGENT_PERSONAS.length} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>You are</th>
              <th>Run this</th>
              <th className="text-right">Typical $</th>
              <th>Skip</th>
            </tr>
          </thead>
          <tbody>
            {AGENT_PERSONAS.map((p) => (
              <tr key={p.slug} id={p.slug}>
                <td className="whitespace-nowrap">
                  <span style={{ color: 'var(--ink)' }}>{p.label}</span>
                </td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>
                  {p.stack}
                </td>
                <td className="mono whitespace-nowrap text-right text-[11.5px]">{costBand(p)}</td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {p.skip}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        typical spend, not sticker &middot; seat prices live on{' '}
        <Link href="/agent-plans" className="underline-offset-2 hover:underline" style={{ color: 'var(--ink-3)' }}>
          /agent-plans
        </Link>
      </p>

      <SectionHeader label="why — the short version" />
      <div className="flex flex-col gap-3">
        {AGENT_PERSONAS.map((p) => (
          <div key={p.slug} className="card !p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="readout" style={{ color: 'var(--phosphor)' }}>
                &#9646; {p.label}
              </span>
              <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                {p.ide} · {p.harness} · {p.model}
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
              {p.why}
            </p>
          </div>
        ))}
      </div>

      <SectionHeader label="what developers actually love" count={landscape.length} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Harness</th>
              <th>Kind</th>
              <th className="text-right">Loved %</th>
              <th className="text-right">7d mentions</th>
              <th>Kept for</th>
              <th>Loses</th>
            </tr>
          </thead>
          <tbody>
            {landscape.map((h) => (
              <tr key={h.name}>
                <td className="whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                  {h.name}
                </td>
                <td className="mono text-[10.5px] uppercase" style={{ color: 'var(--ink-4)' }}>
                  {h.kind}
                </td>
                <td className="mono text-right text-[11.5px]">
                  {h.lovedPct !== null ? `${h.lovedPct}%` : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td className="mono text-right text-[11.5px]">
                  {h.mentions7d > 0 ? h.mentions7d : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {h.role}
                </td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {h.loses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        loved % = Pragmatic Engineer Feb 2026, n=906, single-choice favorite — not install base
        &middot; 7d mentions = curated stories in this radar that name the harness
      </p>

      <SectionHeader label="model + harness pairing" count={MODEL_PAIRINGS.length} />
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Model people reach for</th>
              <th>Where they run it</th>
            </tr>
          </thead>
          <tbody>
            {MODEL_PAIRINGS.map((row) => (
              <tr key={row.job}>
                <td className="text-[11.5px] leading-snug">{row.job}</td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>
                  {row.model}
                </td>
                <td className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {row.harness}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        native harness + native model &middot; mixing frontier models inside Cursor is the expensive path
      </p>

      <SectionHeader label="the app stack models already know" />
      <div className="card !p-4">
        <p className="text-[13px] font-medium">{DEFAULT_APP_STACK.title}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          {DEFAULT_APP_STACK.note} Per-venture layers (auth, payments, hosting) live on{' '}
          <Link href="/stacks" className="underline-offset-2 hover:underline" style={{ color: 'var(--ink-2)' }}>
            /stacks
          </Link>
          .
        </p>
      </div>

      <SectionHeader label="how we track it" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Rankings are seeded by hand from survey and user-report synthesis and re-reviewed every quarter —
          love-rate percentages are not safe to regenerate with an LLM. A weekly job writes each harness&rsquo;s
          loved % and 7-day mention count, plus each persona&rsquo;s typical cost, into our metric store (
          <span className="mono text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
            metric_points · source &lsquo;agent-stacks&rsquo;
          </span>
          ). Mention heat on this page is live from the story graph, so a quiet week shows em-dashes instead of
          last quarter&rsquo;s numbers.
        </p>
        <p className="mt-3 border-t border-[var(--grat-soft)] pt-2.5 text-[12px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          Agents: <span className="mono">list_agent_stacks</span> then{' '}
          <span className="mono">get_agent_stack_for</span>. Seat prices:{' '}
          <Link href="/agent-plans" className="underline-offset-2 hover:underline">
            /agent-plans
          </Link>
          . Product playbooks:{' '}
          <Link href="/stacks" className="underline-offset-2 hover:underline">
            /stacks
          </Link>
          .
        </p>
      </div>

      <div className="mt-9 border-t border-[var(--grat-soft)] pt-3">
        <p className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
          last manual review {AGENT_STACKS_REVIEWED_AT} &middot; reviewed quarterly &middot; no pay-for-placement
        </p>
      </div>
    </main>
  );
}

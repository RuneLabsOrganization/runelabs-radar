import Link from 'next/link';
import { AGENT_STACKS_REVIEWED_AT, costBand } from '@/lib/agent-stacks';
import { publishedAgentStacks } from '@/lib/agent-stacks-sync';
import { timeAgo } from '@/lib/feed';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';

export const metadata = {
  title: 'Agent stacks — which IDE + harness + model to run',
  description:
    'The coding-agent stack builders actually keep: IDE, harness, and model pairings by persona, with survey love-rates, first-party mention heat, and real monthly spend — not just list prices.',
};

/**
 * Sibling of /agent-plans (seat prices) and /stacks (venture playbooks).
 * Seed is editorial; daily job may overlay copy from Brave + radar.
 * 7-day mention heat is always live from the story graph.
 */
export default function AgentStacksPage() {
  const pub = publishedAgentStacks();
  const { personas, landscape, pairings, defaultAppStack } = pub;
  const lovedTotal = landscape.reduce((s, h) => s + h.lovedPct, 0);

  return (
    <main className="mx-auto max-w-[860px] px-6 py-7">
      <PageHeader
        kicker="ide · harness · model — not the product stack"
        title="Agent stacks"
        description="Which editor, agent harness, and model builders actually run — ranked from survey love-rates and user-report cost, with live mention heat from our own feed. Distinct from venture playbooks on Stacks and from seat prices on Agent Plans."
      />
      <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
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
            {personas.map((p) => (
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
        {personas.map((p) => (
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
                  {h.lovedSource === 'remainder' && (
                    <span className="ml-1" style={{ color: 'var(--ink-4)' }}>
                      *
                    </span>
                  )}
                </td>
                <td className="mono text-[10.5px] uppercase" style={{ color: 'var(--ink-4)' }}>
                  {h.kind}
                </td>
                <td className="mono text-right text-[11.5px]">{h.lovedPct}%</td>
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
            <tr>
              <td className="mono text-[10.5px] uppercase" style={{ color: 'var(--ink-4)' }}>
                total
              </td>
              <td />
              <td className="mono text-right text-[11.5px]" style={{ color: 'var(--phosphor)' }}>
                {lovedTotal}%
              </td>
              <td />
              <td colSpan={2} className="mono text-[10px]" style={{ color: 'var(--ink-4)' }}>
                single-choice favorite · closes to 100
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        loved % = Pragmatic Engineer Feb 2026, n=906, single-choice favorite — not install base. 46 / 19 / 9
        are the published top three; * rows split the unpublished 26% remainder from PE usage rank (Codex) and
        named other-loved tools (OpenCode, Windsurf, long tail). Rest of field absorbs rounding.
        &middot; 7d mentions = curated stories in this radar that name the harness — live, not the quarterly review
      </p>

      <SectionHeader label="model + harness pairing" count={pairings.length} />
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
            {pairings.map((row) => (
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
        <p className="text-[13px] font-medium">{defaultAppStack.title}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          {defaultAppStack.note} Per-venture layers (auth, payments, hosting) live on{' '}
          <Link href="/stacks" className="underline-offset-2 hover:underline" style={{ color: 'var(--ink-2)' }}>
            /stacks
          </Link>
          .
        </p>
      </div>

      <SectionHeader label="how we track it" />
      <div className="card !p-4">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Two clocks. Mention heat is live from the story graph (same ingest as Today). A daily job (04:45 UTC)
          searches Brave (news + web, past day) for the coding-agent landscape, then one MiniMax call — tagged{' '}
          <span className="mono text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
            job &lsquo;agent-stacks&rsquo; · feature &lsquo;agent-stacks&rsquo;
          </span>{' '}
          so the cost lands in admin — may refresh copy and cost bands. Loved % is not free to hallucinate: PE
          published Claude Code 46 / Cursor 19 / Copilot 9 stay locked; the unpublished 26% remainder still
          closes to 100. Snapshots go to{' '}
          <span className="mono text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
            metric_points · source &lsquo;agent-stacks&rsquo;
          </span>
          .
        </p>
        {pub.rationale && (
          <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            Latest refresh: {pub.rationale}
          </p>
        )}
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

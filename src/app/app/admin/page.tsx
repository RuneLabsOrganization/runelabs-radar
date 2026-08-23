import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import JobsPanel from '@/components/JobsPanel';
import JobTimeline from '@/components/JobTimeline';
import LlmBudget from '@/components/LlmBudget';
import PipelineFunnel from '@/components/PipelineFunnel';
import ProposalCard, { type ProposedFields } from '@/components/ProposalCard';
import SourcesPanel, { type SourceRow } from '@/components/SourcesPanel';
import SourceVolume from '@/components/SourceVolume';
import PageHeader from '@/components/PageHeader';
import { SectionHeader } from '@/components/ui/section-header';
import { jobHistory, llmUsageHistory, llmUsageTodayByJob, pipelineFunnel, sourceVolume } from '@/lib/analytics';
import { requireAdmin } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardProposals, jobRuns, sources } from '@/lib/db/schema';
import { paths } from '@/lib/urls';

function parseProposed(json: string): ProposedFields {
  const empty: ProposedFields = {
    bestOverall: null,
    bestValue: null,
    cheapestViable: null,
    costNote: null,
  };
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const field = (key: keyof ProposedFields): string | null =>
      typeof obj[key] === 'string' && obj[key] !== '' ? (obj[key] as string) : null;
    return {
      bestOverall: field('bestOverall'),
      bestValue: field('bestValue'),
      cheapestViable: field('cheapestViable'),
      costNote: field('costNote'),
    };
  } catch {
    return empty;
  }
}

export default async function AdminPage() {
  await requireAdmin();
  const db = getDb();

  const pending = db
    .select()
    .from(boardProposals)
    .where(eq(boardProposals.status, 'pending'))
    .orderBy(desc(boardProposals.createdAt))
    .all();

  const sourceRows = db.select().from(sources).orderBy(sources.name).all();

  const runs = db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(20).all();

  const sourceProps: SourceRow[] = sourceRows.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
    config: s.config,
    domainHints: s.domainHints,
    enabled: s.enabled,
    lastStatus: s.lastStatus,
    lastFetchedAt: s.lastFetchedAt ? s.lastFetchedAt.toISOString() : null,
    consecutiveFailures: s.consecutiveFailures,
  }));

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-6 py-7">
      <div>
        <PageHeader kicker="operator console &middot; sources, jobs, proposals" title="Admin" />
        <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
          <Link href={paths.adminUsage} className="hover:underline" style={{ color: 'var(--ink-3)' }}>
            usage &amp; margins &rarr;
          </Link>
        </p>
      </div>

      <section>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          <div>
            <SectionHeader label="Pipeline — 7 days" className="mt-0" />
            <PipelineFunnel funnel={pipelineFunnel()} />
          </div>
          <div>
            <SectionHeader label="LLM budget" className="mt-0" />
            <LlmBudget {...llmUsageHistory()} byJob={llmUsageTodayByJob()} />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader label="Job health — recent runs" className="mt-0" />
        <JobTimeline history={jobHistory()} />
      </section>

      <section>
        <SectionHeader label="Source volume — 14 days" className="mt-0" />
        <SourceVolume rows={sourceVolume()} />
      </section>

      <section>
        <SectionHeader label="Pending proposals" className="mt-0" />
        {pending.length === 0 ? (
          <p className="muted">No pending proposals.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <ProposalCard
                key={p.id}
                id={p.id}
                domain={p.domain}
                task={p.task}
                proposed={parseProposed(p.proposed)}
                rationale={p.rationale}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader label="Sources" className="mt-0" />
        <SourcesPanel sources={sourceProps} />
      </section>

      <section>
        <SectionHeader label="Job runs" className="mt-0" />
        <JobsPanel runs={runs} />
      </section>
    </div>
  );
}

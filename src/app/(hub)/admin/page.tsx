import { desc, eq } from 'drizzle-orm';
import JobsPanel from '@/components/JobsPanel';
import JobTimeline from '@/components/JobTimeline';
import LlmBudget from '@/components/LlmBudget';
import PipelineFunnel from '@/components/PipelineFunnel';
import ProposalCard, { type ProposedFields } from '@/components/ProposalCard';
import SourcesPanel, { type SourceRow } from '@/components/SourcesPanel';
import SourceVolume from '@/components/SourceVolume';
import PageHeader from '@/components/PageHeader';
import { jobHistory, llmUsageHistory, pipelineFunnel, sourceVolume } from '@/lib/analytics';
import { requireAdmin } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardProposals, jobRuns, sources } from '@/lib/db/schema';

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
      </div>

      <section>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          <div>
            <h2 className="section-title">Pipeline — 7 days</h2>
            <PipelineFunnel funnel={pipelineFunnel()} />
          </div>
          <div>
            <h2 className="section-title">LLM budget</h2>
            <LlmBudget {...llmUsageHistory()} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-title">Job health — recent runs</h2>
        <JobTimeline history={jobHistory()} />
      </section>

      <section>
        <h2 className="section-title">Source volume — 14 days</h2>
        <SourceVolume rows={sourceVolume()} />
      </section>

      <section>
        <h2 className="section-title">Pending proposals</h2>
        {pending.length === 0 ? (
          <p className="muted">No pending proposals.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <h2 className="section-title">Sources</h2>
        <SourcesPanel sources={sourceProps} />
      </section>

      <section>
        <h2 className="section-title">Job runs</h2>
        <JobsPanel runs={runs} />
      </section>
    </div>
  );
}

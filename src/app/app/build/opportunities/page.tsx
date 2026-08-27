import { desc } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { factoryFunnel } from '@/lib/analytics';
import { oppViewFromRow } from '@/lib/opportunities/view';
import { visibleTo } from '@/lib/opportunities/scope';
import FactoryPipeline from '@/components/FactoryPipeline';
import OpportunityList from '@/components/OpportunityList';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Opportunities — monetizable openings',
  description:
    'Business openings detected by crossing unmet pains, newly-cheap capability, launch gaps and attention surges — flip/hold scored with launch dossiers.',
};

export default async function OpportunitiesPage() {
  const user = await requireViewer();
  const db = getDb();
  const rows = db
    .select()
    .from(opportunities)
    .where(visibleTo(user?.id ?? null))
    .orderBy(desc(opportunities.flipScore))
    .all();
  const active = rows.filter((r) => r.status === 'active');
  const archivedCount = rows.length - active.length;
  const views = active.map(oppViewFromRow);

  return (
    <div>
      <PageHeader
        kicker="Build · Opportunities"
        title="Opportunities"
        description={
          <>
            Business gaps the scanner found in the news: real user pain, AI that just made the fix cheap, and nobody
            good shipping it yet. Each opening is scored two ways — <span className="mono text-[11px]">flip</span> favors
            building fast and selling into the window, <span className="mono text-[11px]">hold</span> favors keeping it for
            monthly revenue. Open a card for the full dossier: costs, risks, evidence, launch brief.
          </>
        }
      />

      <div className="mt-5">
        <FactoryPipeline funnel={factoryFunnel()} />
      </div>

      {views.length === 0 ? (
        <p className="mono mt-8 text-[12px] text-ink-4">
          No active opportunities yet — the engine synthesizes daily at 07:10 once enough stories have accumulated.
        </p>
      ) : (
        <div className="mt-6">
          <OpportunityList opps={views} canGenerate={!!user} />
        </div>
      )}

      {archivedCount > 0 && (
        <p className="mono mt-6 text-[10.5px] text-ink-4">
          {archivedCount} archived (not re-detected for 7+ days)
        </p>
      )}
    </div>
  );
}

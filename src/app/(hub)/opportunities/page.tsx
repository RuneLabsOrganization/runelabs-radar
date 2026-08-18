import { desc, eq } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { factoryFunnel } from '@/lib/analytics';
import { oppViewFromRow } from '@/lib/opportunities/view';
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
  const rows = db.select().from(opportunities).orderBy(desc(opportunities.flipScore)).all();
  const active = rows.filter((r) => r.status === 'active');
  const archivedCount = rows.length - active.length;
  const views = active.map(oppViewFromRow);

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <PageHeader
        kicker="opportunity engine &middot; daily synthesis"
        title="Opportunities"
        description={
          <>
            Monetizable openings the machine detected by crossing unmet pains, newly-cheap capability,
            launch gaps and attention surges. Radar color is the verdict —
            <span className="mono text-[11px]"> flip</span> favors speed and window,
            <span className="mono text-[11px]"> hold</span> favors margin and durable demand. Expand any
            opening for its launchable brief.
          </>
        }
      />

      {views.length === 0 ? (
        <p className="mono mt-8 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No active opportunities yet — the engine synthesizes daily at 07:10 once enough stories have
          accumulated.
        </p>
      ) : (
        <div className="mt-6">
          <OpportunityList opps={views} canGenerate={!!user} />
        </div>
      )}

      {archivedCount > 0 && (
        <p className="mono mt-6 text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
          {archivedCount} archived (not re-detected for 7+ days)
        </p>
      )}

      {/* engine meta below the content: how the pipeline is flowing */}
      <div className="mt-8">
        <FactoryPipeline funnel={factoryFunnel()} />
      </div>
    </div>
  );
}

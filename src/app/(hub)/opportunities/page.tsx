import { desc, eq } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { factoryFunnel } from '@/lib/analytics';
import { oppViewFromRow } from '@/lib/opportunities/view';
import FactoryPipeline from '@/components/FactoryPipeline';
import OpportunityList from '@/components/OpportunityList';

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
      <div className="readout">opportunity engine &middot; daily synthesis &middot; flip &amp; hold scored</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Opportunities</h1>
      <p className="mt-1.5 max-w-[600px] text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Monetizable openings the machine detected by crossing unmet pains, newly-cheap capability,
        launch gaps and attention surges. Radar color is the verdict —
        <span className="mono text-[11px]"> flip</span> favors speed and window,
        <span className="mono text-[11px]"> hold</span> favors margin and durable demand. Expand any
        opening for its launchable brief.
      </p>

      <div className="mt-5">
        <FactoryPipeline funnel={factoryFunnel()} />
      </div>

      {views.length === 0 ? (
        <p className="mono mt-8 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No active opportunities yet — the engine synthesizes daily at 07:10 once enough signal has
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
    </div>
  );
}

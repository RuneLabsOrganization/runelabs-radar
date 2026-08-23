import { desc } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { factoryFunnel } from '@/lib/analytics';
import { oppViewFromRow } from '@/lib/opportunities/view';
import FactoryPipeline from '@/components/FactoryPipeline';
import OpportunityList from '@/components/OpportunityList';
import { WorkspaceNav } from '@/components/app/WorkspaceNav';

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
    <div>
      <WorkspaceNav section="build" />
      <div className="readout text-phosphor">Build · Opportunities</div>
      <h1 className="type-h1 mt-1">Opportunities</h1>
      <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
        Business gaps the scanner found in the news: real user pain, AI that just made the fix cheap, and nobody
        good shipping it yet. Each opening is scored two ways — <span className="mono text-[11px]">flip</span> favors
        building fast and selling into the window, <span className="mono text-[11px]">hold</span> favors keeping it for
        monthly revenue. Open a card for the full dossier: costs, risks, evidence, launch brief.
      </p>

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

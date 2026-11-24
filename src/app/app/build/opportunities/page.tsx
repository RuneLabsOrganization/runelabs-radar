// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { and, count, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { factoryFunnel } from '@/lib/analytics';
import { oppViewFromRow, rankingFromRow } from '@/lib/opportunities/view';
import { compareOpportunities } from '@/lib/opportunities/ranking';
import { visibleTo } from '@/lib/opportunities/scope';
import { paths } from '@/lib/urls';
import FactoryPipeline from '@/components/FactoryPipeline';
import OpportunityList from '@/components/OpportunityList';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Opportunities — monetizable openings',
  description:
    'Compare opportunities by commercial potential, acquisition economics, reachable buyers and evidence. Explore flip and hold scores for each opening.',
};

/**
 * Card payload cap: every card serializes a full dossier view into the client
 * list, so the default page ships the top slice by commercial score; ?all=1 opts
 * into the complete set.
 */
const DEFAULT_LIMIT = 50;

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const user = await requireViewer();
  const { all } = await searchParams;
  const db = getDb();
  const scope = visibleTo(user?.id ?? null);
  // archived rows stay in the table (and out of the payload) — only the count
  // is rendered; active rows are capped at DEFAULT_LIMIT unless ?all=1
  const active = and(scope, eq(opportunities.status, 'active'));
  const archivedCount =
    db
      .select({ c: count() })
      .from(opportunities)
      .where(and(scope, eq(opportunities.status, 'archived')))
      .get()?.c ?? 0;
  const { rows, activeCount } = db.transaction((tx) => {
    if (all === '1') {
      const rows = tx.select().from(opportunities).where(active).all();
      return { rows, activeCount: rows.length };
    }
    // Rank lightweight inputs across the entire visible set before loading dossiers.
    const candidates = tx.select({
      id: opportunities.id, verdict: opportunities.verdict,
      flipScore: opportunities.flipScore, holdScore: opportunities.holdScore, kpis: opportunities.kpis,
    }).from(opportunities).where(active).all();
    const ids = candidates.map(rankingFromRow).sort(compareOpportunities).slice(0, DEFAULT_LIMIT).map((r) => r.id);
    const rows = tx.select().from(opportunities).where(and(active, inArray(opportunities.id, ids))).all();
    return { rows, activeCount: candidates.length };
  });
  const views = rows.map(oppViewFromRow).sort(compareOpportunities);

  return (
    <div>
      <PageHeader
        kicker="Build · Opportunities"
        title="Opportunities"
        description={
          <>
            Commercial rank combines flip and hold potential with acquisition costs, reachable buyers,
            time to pilot and supporting research. All business models use the same scale.
            Open a dossier to inspect the estimates, assumptions and sources.
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
          {all !== '1' && activeCount > views.length && (
            <p className="mono mb-3 text-[10.5px] text-ink-4">
              showing the top {views.length} of {activeCount} by commercial rank ·{' '}
              <Link
                href={`${paths.opportunities}?all=1`}
                className="underline decoration-grat-strong underline-offset-2 hover:text-ink-3"
              >
                show all {activeCount} →
              </Link>
            </p>
          )}
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

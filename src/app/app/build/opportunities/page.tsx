// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { and, count, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { factoryFunnel } from '@/lib/analytics';
import { oppViewFromRow } from '@/lib/opportunities/view';
import { visibleTo } from '@/lib/opportunities/scope';
import { paths } from '@/lib/urls';
import FactoryPipeline from '@/components/FactoryPipeline';
import OpportunityList from '@/components/OpportunityList';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Opportunities — monetizable openings',
  description:
    'Business openings detected by crossing unmet pains, newly-cheap capability, launch gaps and attention surges — flip/hold scored with launch dossiers.',
};

/**
 * Card payload cap: every card serializes a full dossier view into the client
 * list, so the default page ships the top slice by flip score; ?all=1 opts
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
  const activeCount =
    db
      .select({ c: count() })
      .from(opportunities)
      .where(and(scope, eq(opportunities.status, 'active')))
      .get()?.c ?? 0;
  const archivedCount =
    db
      .select({ c: count() })
      .from(opportunities)
      .where(and(scope, eq(opportunities.status, 'archived')))
      .get()?.c ?? 0;
  const rows = db
    .select()
    .from(opportunities)
    .where(and(scope, eq(opportunities.status, 'active')))
    .orderBy(desc(opportunities.flipScore))
    .limit(all === '1' ? activeCount : DEFAULT_LIMIT)
    .all();
  const views = rows.map(oppViewFromRow);

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

      {all !== '1' && activeCount > views.length && (
        <p className="mono mt-6 text-[10.5px] text-ink-4">
          showing the top {views.length} of {activeCount} by flip score ·{' '}
          <Link
            href={`${paths.opportunities}?all=1`}
            className="underline decoration-grat-strong underline-offset-2 hover:text-ink-3"
          >
            show all {activeCount} →
          </Link>
        </p>
      )}

      {archivedCount > 0 && (
        <p className="mono mt-6 text-[10.5px] text-ink-4">
          {archivedCount} archived (not re-detected for 7+ days)
        </p>
      )}
    </div>
  );
}

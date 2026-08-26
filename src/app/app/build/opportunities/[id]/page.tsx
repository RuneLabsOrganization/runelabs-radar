import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getIdentity } from '@/lib/identity';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';
import { oppViewFromRow } from '@/lib/opportunities/view';
import { lookupVisibleOpportunity } from '@/lib/opportunities/lookup';
import { getLatestDebateForOpportunity } from '@/lib/opportunities/debate-view';
import { paths, urls } from '@/lib/urls';
import OppDossier from '@/components/OppDossier';
import OppBrief from '@/components/OppBrief';
import BriefSection from '@/components/BriefSection';
import DebateTranscript from '@/components/DebateTranscript';
import { AddToBatchButton } from '@/components/batches/AddToBatchButton';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireViewer();
  const row = lookupVisibleOpportunity(id, user?.id ?? null);
  if (!row) return {};
  const description = row.thesis.slice(0, 160);
  return {
    title: row.title,
    description,
    openGraph: { title: row.title, description, type: 'article' },
  };
}

/** One monetizable opening, fully dossiered at a stable URL. */
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireViewer();
  const row = lookupVisibleOpportunity(id, user?.id ?? null);
  if (!row) notFound();
  const opp = oppViewFromRow(row);
  const debate = getLatestDebateForOpportunity(row.id);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opp.title,
    description: opp.thesis,
    datePublished: row.firstSeenAt.toISOString(),
    mainEntityOfPage: urls.opportunity(row.slug ?? row.id),
    author: { '@type': 'Organization', name: getIdentity().productName },
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />


      {/* kicker: what this is, where it lives, how fresh */}
      <div className="mono flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[10.5px] uppercase tracking-[0.08em]">
        <Link href={paths.opportunities} className="text-ink-4 hover:underline">
          opportunities
        </Link>
        <span className="text-ink-4">·</span>
        {opp.sector && isDomain(opp.sector) && (
          <span className="inline-flex items-center gap-1.5 text-ink-3">
            <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[opp.sector] }} />
            {DOMAIN_LABELS[opp.sector]}
          </span>
        )}
        <span className="text-ink-4">first seen {opp.firstSeenLabel}</span>
        {opp.isNew && <span className="text-phosphor">● new</span>}
        {row.planRuns > 0 && (
          <span className="text-ink-3" title="successful plan generations for this opening">
            · {row.planRuns} {row.planRuns === 1 ? 'builder' : 'builders'} exploring this
          </span>
        )}
        {row.status === 'archived' && (
          <span className="rounded-[3px] border border-grat px-1.5 py-0.5 text-ink-4">
            archived
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-start justify-between gap-3">
        <h1 className="type-h1 max-w-xl">{opp.title}</h1>
        {user && (
          <AddToBatchButton refType="opportunity" refId={opp.id} refKey={row.slug} />
        )}
      </div>

      <div className="mt-6">
        <OppDossier opp={opp} sortKey="flip" />
      </div>

      <div className="mt-7">
        <div className="readout mb-2.5">the launchable brief</div>
        {opp.brief ? (
          <OppBrief brief={opp.brief} />
        ) : (
          <BriefSection id={opp.id} canGenerate={!!user} initialBrief={null} />
        )}
      </div>

      <div id="debate" className="mt-7 scroll-mt-20">
        <div className="readout mb-2.5">the debate</div>
        {debate ? (
          <DebateTranscript debate={debate} />
        ) : (
          <p className="text-[13px] text-ink-4">
            No debate yet — the top new openings get one automatically after each daily sweep.
          </p>
        )}
      </div>
    </div>
  );
}

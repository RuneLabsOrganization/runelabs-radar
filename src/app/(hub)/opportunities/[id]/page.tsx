import { notFound } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';
import { oppViewFromRow } from '@/lib/opportunities/view';
import OppDossier from '@/components/OppDossier';
import OppBrief from '@/components/OppBrief';
import BriefSection from '@/components/BriefSection';

function getOpportunity(id: number) {
  return getDb().select().from(opportunities).where(eq(opportunities.id, id)).get();
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getOpportunity(Number(id));
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
  const oppId = Number(id);
  if (!Number.isInteger(oppId) || oppId <= 0) notFound();

  const user = await requireViewer();
  const row = getOpportunity(oppId);
  if (!row) notFound();
  const opp = oppViewFromRow(row);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opp.title,
    description: opp.thesis,
    datePublished: row.firstSeenAt.toISOString(),
    mainEntityOfPage: `${config.siteUrl}/opportunities/${opp.id}`,
    author: { '@type': 'Organization', name: getIdentity().productName },
  };

  return (
    <div className="mx-auto max-w-[860px] px-6 py-7">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* kicker: what this is, where it lives, how fresh */}
      <div className="mono flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[10.5px] tracking-[0.08em] uppercase">
        <Link href="/opportunities" className="hover:underline" style={{ color: 'var(--ink-4)' }}>
          opportunities
        </Link>
        <span style={{ color: 'var(--ink-4)' }}>·</span>
        {opp.sector && isDomain(opp.sector) && (
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
            <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[opp.sector] }} />
            {DOMAIN_LABELS[opp.sector]}
          </span>
        )}
        <span style={{ color: 'var(--ink-4)' }}>first seen {opp.firstSeenLabel}</span>
        {opp.isNew && <span style={{ color: 'var(--phosphor)' }}>● new</span>}
        {row.status === 'archived' && (
          <span className="rounded-[3px] border border-[var(--grat)] px-1.5 py-0.5" style={{ color: 'var(--ink-4)' }}>
            archived
          </span>
        )}
      </div>

      <h1 className="mt-2.5 text-[21px] leading-snug font-semibold tracking-[-0.01em]">{opp.title}</h1>

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
    </div>
  );
}

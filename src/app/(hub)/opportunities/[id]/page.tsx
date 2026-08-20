import { notFound } from 'next/navigation';
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { debates, opportunities } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { getIdentity } from '@/lib/identity';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain } from '@/lib/domains';
import { oppViewFromRow } from '@/lib/opportunities/view';
import OppDossier, { VerdictChip } from '@/components/OppDossier';
import OppBrief from '@/components/OppBrief';
import BriefSection from '@/components/BriefSection';

function getOpportunity(id: number) {
  return getDb().select().from(opportunities).where(eq(opportunities.id, id)).get();
}

const ROLE_LABEL: Record<string, string> = {
  advocate: 'the advocate',
  skeptic: 'the skeptic',
  realist: 'the market realist',
  judge: 'the judge',
};

interface DebateView {
  verdict: 'pursue' | 'watch' | 'reject';
  confidence: number;
  turns: { role: string; text: string }[];
  killRisks: string[];
  conditionsToSucceed: string[];
  strengthenedVariants: string[];
}

/** The latest debate for this opportunity, parsed defensively for render. */
function getLatestDebate(oppId: number): DebateView | null {
  const row = getDb()
    .select()
    .from(debates)
    .where(eq(debates.opportunityId, oppId))
    .orderBy(desc(debates.createdAt), desc(debates.id))
    .limit(1)
    .get();
  if (!row) return null;
  const view: DebateView = {
    verdict: row.verdict,
    confidence: row.confidence,
    turns: [],
    killRisks: [],
    conditionsToSucceed: [],
    strengthenedVariants: [],
  };
  try {
    const parsed: unknown = JSON.parse(row.transcript);
    if (!Array.isArray(parsed)) return view;
    const strs = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    for (const raw of parsed) {
      if (typeof raw !== 'object' || raw === null) continue;
      const t = raw as Record<string, unknown>;
      if (typeof t.role !== 'string' || typeof t.text !== 'string') continue;
      view.turns.push({ role: t.role, text: t.text });
      // the judge's turn carries the structured outcome (see critic.runDebate)
      if (t.role === 'judge') {
        view.killRisks = strs(t.killRisks);
        view.conditionsToSucceed = strs(t.conditionsToSucceed);
        view.strengthenedVariants = strs(t.strengthenedVariants);
      }
    }
  } catch {
    /* corrupt transcript — render verdict + confidence only */
  }
  return view;
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
  const debate = getLatestDebate(oppId);

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
        {row.planRuns > 0 && (
          <span style={{ color: 'var(--ink-3)' }} title="successful plan generations for this opening">
            · {row.planRuns} {row.planRuns === 1 ? 'builder' : 'builders'} exploring this
          </span>
        )}
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

      <div className="mt-7">
        <div className="readout mb-2.5">the debate</div>
        {debate ? (
          <div className="anim-in border-t border-[var(--grat-soft)] pt-4">
            <div className="flex items-center gap-2.5">
              <VerdictChip verdict={debate.verdict} />
              <span className="mono text-[11px]" style={{ color: 'var(--ink-3)' }}>
                confidence {debate.confidence}/100
              </span>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {debate.turns.map((t, i) => (
                <div key={i}>
                  <div className="readout mb-1.5">{ROLE_LABEL[t.role] ?? t.role}</div>
                  <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                    {t.text}
                  </p>
                </div>
              ))}
            </div>
            {(debate.killRisks.length > 0 ||
              debate.conditionsToSucceed.length > 0 ||
              debate.strengthenedVariants.length > 0) && (
              <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-[var(--grat-soft)] pt-4 md:grid-cols-2">
                {debate.killRisks.length > 0 && (
                  <div>
                    <div className="readout mb-1.5">kill risks</div>
                    <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
                      {debate.killRisks.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span aria-hidden style={{ color: 'var(--amber)' }}>◆</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {debate.conditionsToSucceed.length > 0 && (
                  <div>
                    <div className="readout mb-1.5">conditions to succeed</div>
                    <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
                      {debate.conditionsToSucceed.map((c, i) => (
                        <li key={i}>· {c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {debate.strengthenedVariants.length > 0 && (
                  <div>
                    <div className="readout mb-1.5">strengthened variants</div>
                    <ul className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
                      {debate.strengthenedVariants.map((v, i) => (
                        <li key={i} className="flex gap-2">
                          <span aria-hidden style={{ color: 'var(--phosphor)' }}>▸</span>
                          <span>{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--ink-4)' }}>
            No debate yet — the top new openings get one automatically after each daily sweep.
          </p>
        )}
      </div>
    </div>
  );
}

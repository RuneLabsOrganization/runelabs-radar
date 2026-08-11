import { desc, eq } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { timeAgo } from '@/lib/feed';
import { factoryFunnel } from '@/lib/analytics';
import { sanitizeBrief } from '@/lib/opportunities/brief';
import FactoryPipeline from '@/components/FactoryPipeline';
import { sanitizeKpis, SUB_KEYS, type OppKpis, type SubScores } from '@/lib/opportunities/engine';
import OpportunityList, { type OppView } from '@/components/OpportunityList';

function parseSub(json: string): SubScores {
  const zero = Object.fromEntries(SUB_KEYS.map((k) => [k, 0])) as SubScores;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    for (const k of SUB_KEYS) {
      if (typeof parsed[k] === 'number') zero[k] = parsed[k] as number;
    }
    return zero;
  } catch {
    return zero;
  }
}

export const metadata = {
  title: 'Opportunities — monetizable openings',
  description:
    'Business openings detected by crossing unmet pains, newly-cheap capability, launch gaps and attention surges — flip/hold scored with launch dossiers.',
};

function parseEvidence(json: string): { type: string; label: string }[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is { type: string; label: string } =>
        typeof e === 'object' && e !== null && typeof (e as { label?: unknown }).label === 'string',
    );
  } catch {
    return [];
  }
}

export default async function OpportunitiesPage() {
  const user = await requireViewer();
  const db = getDb();
  const rows = db.select().from(opportunities).orderBy(desc(opportunities.flipScore)).all();
  const active = rows.filter((r) => r.status === 'active');
  const archivedCount = rows.length - active.length;

  const views: OppView[] = active.map((r) => {
    let brief = null;
    if (r.brief) {
      try {
        brief = sanitizeBrief(JSON.parse(r.brief));
      } catch {
        brief = null;
      }
    }
    let kpis: OppKpis | null = null;
    if (r.kpis) {
      try {
        kpis = sanitizeKpis(JSON.parse(r.kpis));
      } catch {
        kpis = null;
      }
    }
    let legacy = true;
    try {
      const raw = JSON.parse(r.scores) as Record<string, unknown>;
      legacy = typeof raw.moat !== 'number'; // pre-dossier assessments lack the new axes
    } catch {
      legacy = true;
    }
    return {
      id: r.id,
      title: r.title,
      thesis: r.thesis,
      sector: r.sector,
      window: r.window,
      flipScore: r.flipScore,
      holdScore: r.holdScore,
      sub: parseSub(r.scores),
      kpis,
      legacy,
      evidence: parseEvidence(r.evidence),
      brief,
      firstSeenLabel: timeAgo(r.firstSeenAt),
      isNew: Date.now() - r.firstSeenAt.getTime() < 864e5,
    };
  });

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

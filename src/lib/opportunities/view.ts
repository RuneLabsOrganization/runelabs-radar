import { sanitizeBrief } from './brief';
import { enrichEvidence, type EvidenceItem } from './evidence';
import { parseSubScores } from './axes';
import { sanitizeKpis, type OppKpis } from './engine';
import { timeAgo } from '../feed';
import type { opportunities } from '../db/schema';
import type { OppReview, OppView, Verdict } from '@/components/OppDossier';

type OppRow = typeof opportunities.$inferSelect;

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

/** The stored review trail, reduced to what the dossier renders. */
function parseReview(json: string | null): OppReview | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const strArr = (v: unknown, max: number): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, max) : [];
    const caps = Array.isArray(parsed.capsApplied)
      ? parsed.capsApplied.flatMap((c) => {
          if (typeof c !== 'object' || c === null) return [];
          const r = c as Record<string, unknown>;
          if (typeof r.play !== 'string' || typeof r.rule !== 'string') return [];
          if (typeof r.from !== 'number' || typeof r.to !== 'number') return [];
          return [{ play: r.play === 'flip' ? ('flip' as const) : ('hold' as const), rule: r.rule, from: r.from, to: r.to }];
        })
      : [];
    return {
      killRisks: strArr(parsed.killRisks, 3),
      flags: strArr(parsed.flags, 5),
      capsApplied: caps,
      criticUnavailable: parsed.criticUnavailable === true,
    };
  } catch {
    return null;
  }
}

/** Row → the view model shared by the list page and the detail page. */
export function oppViewFromRow(r: OppRow): OppView {
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
  // the ONE shared parser decides both the sub-scores and the legacy flag —
  // the dossier never scores a stored row differently from rescore/forge
  const parsedScores = parseSubScores(r.scores);
  const legacy = parsedScores.legacy;
  const evidence: EvidenceItem[] = enrichEvidence(parseEvidence(r.evidence));
  return {
    id: r.id,
    title: r.title,
    thesis: r.thesis,
    sector: r.sector,
    window: r.window,
    flipScore: r.flipScore,
    holdScore: r.holdScore,
    verdict: r.verdict as Verdict,
    confidence: r.confidence,
    review: parseReview(r.review),
    sub: parsedScores.sub,
    kpis,
    legacy,
    evidence,
    brief,
    firstSeenLabel: timeAgo(r.firstSeenAt),
    isNew: Date.now() - r.firstSeenAt.getTime() < 864e5,
  };
}

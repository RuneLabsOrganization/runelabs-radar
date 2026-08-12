import { sanitizeBrief } from './brief';
import { enrichEvidence, type EvidenceItem } from './evidence';
import { sanitizeKpis, SUB_KEYS, type OppKpis, type SubScores } from './engine';
import { timeAgo } from '../feed';
import type { opportunities } from '../db/schema';
import type { OppView } from '@/components/OppDossier';

type OppRow = typeof opportunities.$inferSelect;

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
  let legacy = true;
  try {
    const raw = JSON.parse(r.scores) as Record<string, unknown>;
    legacy = typeof raw.moat !== 'number'; // pre-dossier assessments lack the new axes
  } catch {
    legacy = true;
  }
  const evidence: EvidenceItem[] = enrichEvidence(parseEvidence(r.evidence));
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
    evidence,
    brief,
    firstSeenLabel: timeAgo(r.firstSeenAt),
    isNew: Date.now() - r.firstSeenAt.getTime() < 864e5,
  };
}

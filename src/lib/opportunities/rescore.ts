import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { drainLlmUsageStats } from '../llm/minimax';
import { SUB_KEYS, type SubScores } from './axes';
import { sanitizeKpis, type OppDraft, type OppKpis } from './engine';
import { applyGate, parseWindowMonths, unverifiedCritic } from './gate';
import { runCritique } from './critic';
import { publicOnly } from './scope';

type OppRow = typeof opportunities.$inferSelect;

function parseSub(json: string): { sub: SubScores; legacy: boolean } {
  const zero = Object.fromEntries(SUB_KEYS.map((k) => [k, 0])) as SubScores;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // R10: rows pre-dating the 10-axis dossier stay legacy — next sweep re-scores them
    if (typeof parsed.moat !== 'number') return { sub: zero, legacy: true };
    for (const k of SUB_KEYS) {
      if (typeof parsed[k] === 'number')
        zero[k] = Math.max(0, Math.min(20, Math.round(parsed[k] as number)));
    }
    return { sub: zero, legacy: false };
  } catch {
    return { sub: zero, legacy: true };
  }
}

export function parseKpis(json: string | null): OppKpis {
  if (!json) return sanitizeKpis(null);
  try {
    return sanitizeKpis(JSON.parse(json));
  } catch {
    return sanitizeKpis(null);
  }
}

export function parseStoredEvidence(json: string): { type: string; label: string }[] {
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

/**
 * Backfill for the layered pipeline: re-run the adversarial critic + gate on
 * the CURRENT active rows (no re-proposal) so yesterday's inflated scores get
 * corrected without waiting for the next sweep. Manual job: `npm run job --
 * opp-rescore`. Writes the gated values DIRECTLY — the whole point is to
 * correct a prior the old pipeline produced, so no hysteresis blend here
 * (blending would drag the fix back toward the number we're correcting).
 */
export async function runOppRescore(): Promise<{
  considered: number;
  rescored: number;
  skippedLegacy: number;
}> {
  const db = getDb();
  const rows = db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.status, 'active'), publicOnly()))
    .all();

  const targets: { row: OppRow; draft: OppDraft; evidenceCount: number }[] = [];
  for (const row of rows) {
    const { sub, legacy } = parseSub(row.scores);
    if (legacy) continue;
    targets.push({
      row,
      draft: {
        slug: row.slug,
        title: row.title,
        thesis: row.thesis,
        sector: row.sector,
        window: row.window,
        windowMonths: row.windowMonths ?? parseWindowMonths(row.window),
        sub,
        kpis: parseKpis(row.kpis),
        evidenceRefs: [], // filled below with per-row stored-evidence refs
      },
      evidenceCount: 0,
    });
  }

  // the critic attacks from evidence — stored rows carry labels, not sweep
  // refs, so re-key them per row ([slug-E1] …) and present them as the blocks
  const blocks = targets
    .map((t) => {
      const stored = parseStoredEvidence(t.row.evidence);
      t.draft.evidenceRefs = stored.map((_, j) => `${t.row.slug}-E${j + 1}`);
      t.evidenceCount = stored.length;
      if (stored.length === 0) return '';
      return (
        `<evidence for "${t.row.slug}">\n` +
        stored.map((e, j) => `[${t.row.slug}-E${j + 1}] (${e.type}) ${e.label}`).join('\n') +
        '\n</evidence>'
      );
    })
    .filter(Boolean)
    .join('\n\n');

  const critiques =
    targets.length > 0 ? await runCritique(targets.map((t) => t.draft), blocks) : new Map();

  const now = new Date();
  let rescored = 0;
  for (const t of targets) {
    const critic = critiques?.get(t.row.slug) ?? unverifiedCritic(t.row.slug);
    const gate = applyGate(
      {
        sub: t.draft.sub,
        kpis: t.draft.kpis,
        windowMonths: t.draft.windowMonths,
        evidenceCount: t.evidenceCount,
        legacy: false,
      },
      critic,
    );
    db.update(opportunities)
      .set({
        flipScore: gate.flipScore,
        holdScore: gate.holdScore,
        windowMonths: t.draft.windowMonths,
        verdict: gate.verdict,
        confidence: gate.confidence,
        review: JSON.stringify(gate.review),
        reviewedAt: now,
      })
      .where(eq(opportunities.id, t.row.id))
      .run();
    rescored++;
  }

  return {
    considered: rows.length,
    rescored,
    skippedLegacy: rows.length - targets.length,
    ...drainLlmUsageStats(),
  };
}

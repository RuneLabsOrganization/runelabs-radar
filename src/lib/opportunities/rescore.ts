import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { drainLlmUsageStats } from '../llm/minimax';
import { parseSubScores, type SubKey } from './axes';
import { sanitizeKpis, type OppDraft, type OppKpis } from './engine';
import { applyGate, parseWindowMonths, type CriticResult } from './gate';
import { runCritique } from './critic';
import { publicOnly } from './scope';

type OppRow = typeof opportunities.$inferSelect;

/** Openings per critic call — a full-table call times out (see runOppRescore). */
const CRITIC_BATCH = 6;

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
  /** rows the critic could not review this run — their stored verdict is left untouched */
  unreviewed: number;
  skippedLegacy: number;
}> {
  const db = getDb();
  const rows = db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.status, 'active'), publicOnly()))
    .all();

  const targets: { row: OppRow; draft: OppDraft; evidenceCount: number; missingAxes: SubKey[] }[] = [];
  for (const row of rows) {
    const { sub, legacy, missing } = parseSubScores(row.scores);
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
      missingAxes: missing,
    });
  }

  // the critic attacks from evidence — stored rows carry labels, not sweep
  // refs, so re-key them per row ([slug-E1] …) and present them as the blocks
  const blockOf = new Map<string, string>();
  for (const t of targets) {
    const stored = parseStoredEvidence(t.row.evidence);
    t.draft.evidenceRefs = stored.map((_, j) => `${t.row.slug}-E${j + 1}`);
    t.evidenceCount = stored.length;
    blockOf.set(
      t.row.slug,
      stored.length === 0
        ? ''
        : `<evidence for "${t.row.slug}">\n` +
            stored.map((e, j) => `[${t.row.slug}-E${j + 1}] (${e.type}) ${e.label}`).join('\n') +
            '\n</evidence>',
    );
  }

  // The critic is one LLM call per batch: all ~45 active rows in a single call
  // outrun the per-call deadline, runCritique then returns null, and every row
  // would be stamped "unverified, watch/40". Review in small batches instead.
  const critiques = new Map<string, CriticResult>();
  for (let i = 0; i < targets.length; i += CRITIC_BATCH) {
    const chunk = targets.slice(i, i + CRITIC_BATCH);
    const res = await runCritique(
      chunk.map((t) => t.draft),
      chunk.map((t) => blockOf.get(t.row.slug) ?? '').filter(Boolean).join('\n\n'),
    );
    if (res) for (const [slug, review] of res) critiques.set(slug, review);
  }

  const now = new Date();
  let rescored = 0;
  let unreviewed = 0;
  for (const t of targets) {
    // a row the critic could not review keeps its stored verdict — absence of a
    // review must not overwrite a real one with "unverified"
    const reviewed = critiques.get(t.row.slug);
    if (!reviewed) {
      unreviewed++;
      continue;
    }
    const critic = reviewed;
    const gate = applyGate(
      {
        sub: t.draft.sub,
        kpis: t.draft.kpis,
        windowMonths: t.draft.windowMonths,
        evidenceCount: t.evidenceCount,
        legacy: false,
        missingAxes: t.missingAxes,
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
    unreviewed,
    skippedLegacy: rows.length - targets.length,
    ...drainLlmUsageStats(),
  };
}

/**
 * Rung 2 — the adversarial deep pass.
 *
 * Four sequential LLM calls (advocate → skeptic → realist → judge) run against
 * one opening, then the deterministic gate re-scores it from the debate
 * outcome. Expensive and explicit: it is only ever reached through the
 * forge_opportunity tool, never implicitly.
 *
 * Reuses runDebate() and applyGate() rather than growing a parallel pipeline —
 * a forged verdict must be explainable by exactly the same trail as a daily one.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { SUB_KEYS, type SubScores } from './axes';
import { runDebate } from './critic';
import { applyGate, type CriticResult } from './gate';
import { parseKpis, parseStoredEvidence } from './rescore';
import { visibleTo } from './scope';

export interface ForgeResult {
  ok: boolean;
  error?: string;
  flipScore?: number;
  holdScore?: number;
  verdict?: string;
  confidence?: number;
  killRisks?: string[];
  conditionsToSucceed?: string[];
  strengthenedVariants?: string[];
}

function parseSub(raw: string): SubScores {
  const out = {} as SubScores;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* fall through to zeros */
  }
  for (const k of SUB_KEYS) {
    const v = parsed[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(20, v)) : 0;
  }
  return out;
}

/**
 * Forge one opening. The caller must own it, or it must be a public radar row
 * — anyone may pressure-test the canonical radar, nobody may touch someone
 * else's private opening.
 */
export async function forgeOpportunity(
  opportunityId: number,
  userId: number,
): Promise<ForgeResult> {
  const db = getDb();
  const row = db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        visibleTo(userId),
      ),
    )
    .get();
  if (!row) return { ok: false, error: 'No such opportunity in your scope.' };

  let debate;
  try {
    debate = await runDebate(opportunityId, undefined, userId, 'forge');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // The judge's outcome IS the critic result — same shape the gate already consumes.
  const critic: CriticResult = {
    slug: row.slug,
    verdict: debate.verdict,
    confidence: debate.confidence,
    killRisks: debate.killRisks,
    adjustments: [],
    flags: ['forged'],
  };

  const gate = applyGate(
    {
      sub: parseSub(row.scores),
      kpis: parseKpis(row.kpis),
      windowMonths: row.windowMonths,
      evidenceCount: parseStoredEvidence(row.evidence).length,
      legacy: false,
    },
    critic,
  );

  const review = {
    ...gate.review,
    flags: [...gate.review.flags, 'forged'],
    conditionsToSucceed: debate.conditionsToSucceed,
    strengthenedVariants: debate.strengthenedVariants,
  };

  db.update(opportunities)
    .set({
      flipScore: gate.flipScore,
      holdScore: gate.holdScore,
      verdict: gate.verdict,
      confidence: gate.confidence,
      review: JSON.stringify(review),
      reviewedAt: new Date(),
    })
    .where(eq(opportunities.id, opportunityId))
    .run();

  return {
    ok: true,
    flipScore: gate.flipScore,
    holdScore: gate.holdScore,
    verdict: gate.verdict,
    confidence: gate.confidence,
    killRisks: debate.killRisks,
    conditionsToSucceed: debate.conditionsToSucceed,
    strengthenedVariants: debate.strengthenedVariants,
  };
}

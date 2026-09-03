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
 *
 * Forging a PUBLIC radar row never mutates the canonical opening: the daily
 * engine owns those scores (and blends them into future sweeps via hysteresis),
 * so the forge works on an owner-scoped copy — same visibility rules as any
 * other user-owned row. Forging one's own row re-scores it in place.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { SUB_KEYS, type SubScores } from './axes';
import { runDebate } from './critic';
import { applyGate, type CriticResult } from './gate';
import { parseKpis, parseStoredEvidence } from './rescore';
import { visibleTo } from './scope';

type OppRow = typeof opportunities.$inferSelect;

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
 * The user-owned working copy of a public opening: same content, owner set,
 * plan/crowdedness counters reset. A repeated forge of the same opening
 * reuses the existing copy (owner+slug is the table's unique key).
 */
function copyForOwner(row: OppRow, userId: number): OppRow {
  const db = getDb();
  const existing = db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.slug, row.slug), eq(opportunities.ownerUserId, userId)))
    .get();
  if (existing) return existing;
  const now = new Date();
  return db
    .insert(opportunities)
    .values({
      slug: row.slug,
      ownerUserId: userId,
      title: row.title,
      thesis: row.thesis,
      sector: row.sector,
      status: 'active',
      flipScore: row.flipScore,
      holdScore: row.holdScore,
      scores: row.scores,
      kpis: row.kpis,
      evidence: row.evidence,
      window: row.window,
      windowMonths: row.windowMonths,
      verdict: row.verdict,
      confidence: row.confidence,
      review: row.review,
      reviewedAt: row.reviewedAt,
      brief: row.brief,
      briefGeneratedAt: row.briefGeneratedAt,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get()!;
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

  // The canonical public row is engine-owned: forge a private copy so the
  // shared radar's scores, verdict and review trail survive untouched.
  const target = row.ownerUserId === null ? copyForOwner(row, userId) : row;

  let debate;
  try {
    debate = await runDebate(target.id, undefined, userId, 'forge');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // The judge's outcome IS the critic result — same shape the gate already consumes.
  const critic: CriticResult = {
    slug: target.slug,
    verdict: debate.verdict,
    confidence: debate.confidence,
    killRisks: debate.killRisks,
    adjustments: [],
    flags: ['forged'],
  };

  const gate = applyGate(
    {
      sub: parseSub(target.scores),
      kpis: parseKpis(target.kpis),
      windowMonths: target.windowMonths,
      evidenceCount: parseStoredEvidence(target.evidence).length,
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
    .where(eq(opportunities.id, target.id))
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

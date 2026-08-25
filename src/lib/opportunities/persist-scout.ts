/**
 * Persist scout drafts as active opportunities so generate_plan can find them.
 * Uses the unverified critic + gate (same path as a thin daily refresh) — no
 * extra critique LLM calls; scout already spent one proposer call.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { applyGate, unverifiedCritic } from './gate';
import { normalizeSlug, type OppDraft } from './engine';

export interface PersistScoutResult {
  persisted: { slug: string; id: number; created: boolean }[];
}

export function persistScoutDrafts(drafts: OppDraft[]): PersistScoutResult {
  const db = getDb();
  const now = new Date();
  const persisted: PersistScoutResult['persisted'] = [];

  for (const d of drafts) {
    const slug = normalizeSlug(d.slug);
    if (!slug) continue;
    const critic = unverifiedCritic(slug);
    const gate = applyGate(
      {
        sub: d.sub,
        kpis: d.kpis,
        windowMonths: d.windowMonths,
        evidenceCount: d.evidenceRefs.length,
        legacy: false,
      },
      critic,
    );
    const evidence = d.evidenceRefs.map((label) => ({ type: 'scout', label }));
    const review = {
      ...gate.review,
      flags: [...gate.review.flags, 'scout-persisted'],
    };
    const values = {
      title: d.title,
      thesis: d.thesis,
      sector: d.sector,
      status: 'active' as const,
      flipScore: gate.flipScore,
      holdScore: gate.holdScore,
      scores: JSON.stringify(d.sub),
      kpis: JSON.stringify(d.kpis),
      evidence: JSON.stringify(evidence),
      window: d.window,
      windowMonths: d.windowMonths,
      verdict: gate.verdict,
      confidence: gate.confidence,
      review: JSON.stringify(review),
      reviewedAt: now,
      lastSeenAt: now,
    };

    const prior = db.select().from(opportunities).where(eq(opportunities.slug, slug)).get();
    if (prior) {
      db.update(opportunities).set(values).where(eq(opportunities.id, prior.id)).run();
      persisted.push({ slug, id: prior.id, created: false });
    } else {
      const inserted = db
        .insert(opportunities)
        .values({ slug, ...values, firstSeenAt: now })
        .returning({ id: opportunities.id })
        .get();
      if (inserted) persisted.push({ slug, id: inserted.id, created: true });
    }
  }

  return { persisted };
}

/**
 * Debate rows as the hub pages render them: parsed transcript, visibility,
 * and the card list that must not leak private openings to strangers.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { debates, opportunities } from '../db/schema';
import { visibleTo } from './scope';

export interface DebateView {
  verdict: 'pursue' | 'watch' | 'reject';
  confidence: number;
  turns: { role: string; text: string }[];
  killRisks: string[];
  conditionsToSucceed: string[];
  strengthenedVariants: string[];
}

export interface DebateCard {
  id: number;
  title: string;
  opportunitySlug: string | null;
  verdict: DebateView['verdict'];
  confidence: number;
  createdAt: Date;
}

function emptyView(verdict: DebateView['verdict'], confidence: number): DebateView {
  return {
    verdict,
    confidence,
    turns: [],
    killRisks: [],
    conditionsToSucceed: [],
    strengthenedVariants: [],
  };
}

export function parseStoredDebate(row: {
  verdict: DebateView['verdict'];
  confidence: number;
  transcript: string;
}): DebateView {
  const view = emptyView(row.verdict, row.confidence);
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
      if (t.role === 'judge') {
        view.killRisks = strs(t.killRisks);
        view.conditionsToSucceed = strs(t.conditionsToSucceed);
        view.strengthenedVariants = strs(t.strengthenedVariants);
      }
    }
  } catch {
    /* corrupt transcript — verdict + confidence only */
  }
  return view;
}

function cardTitle(ideaText: string | null, fallback: string): string {
  const text = (ideaText ?? fallback).trim();
  return text.length > 0 ? text.slice(0, 120) : fallback;
}

export function loadVisibleDebate(
  id: number,
  userId: number | null,
): { view: DebateView; title: string; opportunitySlug: string | null } | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const db = getDb();
  const row = db.select().from(debates).where(eq(debates.id, id)).get();
  if (!row) return null;

  if (row.opportunityId != null) {
    const opp = db
      .select({ slug: opportunities.slug, title: opportunities.title })
      .from(opportunities)
      .where(and(eq(opportunities.id, row.opportunityId), visibleTo(userId)))
      .get();
    if (!opp) return null;
    return {
      view: parseStoredDebate(row),
      title: opp.title,
      opportunitySlug: opp.slug,
    };
  }

  // Free-text ideas are private: only the user who asked for the debate may
  // ever read it (they contain unvetted business ideas).
  if (userId == null || row.ownerId !== userId) return null;

  return {
    view: parseStoredDebate(row),
    title: cardTitle(row.ideaText, 'Free-text idea'),
    opportunitySlug: null,
  };
}

export function listVisibleDebateCards(userId: number | null, limit = 40): DebateCard[] {
  const db = getDb();
  const rows = db
    .select({
      id: debates.id,
      opportunityId: debates.opportunityId,
      ideaText: debates.ideaText,
      ownerId: debates.ownerId,
      verdict: debates.verdict,
      confidence: debates.confidence,
      createdAt: debates.createdAt,
    })
    .from(debates)
    .orderBy(desc(debates.createdAt))
    .limit(limit)
    .all();

  const oppById = new Map(
    db
      .select({ id: opportunities.id, title: opportunities.title, slug: opportunities.slug })
      .from(opportunities)
      .where(visibleTo(userId))
      .all()
      .map((o) => [o.id, o]),
  );

  const cards: DebateCard[] = [];
  for (const d of rows) {
    if (d.opportunityId != null) {
      const opp = oppById.get(d.opportunityId);
      if (!opp) continue;
      cards.push({
        id: d.id,
        title: opp.title,
        opportunitySlug: opp.slug,
        verdict: d.verdict,
        confidence: d.confidence,
        createdAt: d.createdAt,
      });
      continue;
    }
    // Free-text idea cards are private to the user who asked for the debate.
    if (userId == null || d.ownerId !== userId) continue;
    cards.push({
      id: d.id,
      title: cardTitle(d.ideaText, 'Free-text idea'),
      opportunitySlug: null,
      verdict: d.verdict,
      confidence: d.confidence,
      createdAt: d.createdAt,
    });
  }
  return cards;
}

export function getLatestDebateForOpportunity(oppId: number): DebateView | null {
  const row = getDb()
    .select()
    .from(debates)
    .where(eq(debates.opportunityId, oppId))
    .orderBy(desc(debates.createdAt), desc(debates.id))
    .limit(1)
    .get();
  return row ? parseStoredDebate(row) : null;
}

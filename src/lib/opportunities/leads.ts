/**
 * Lead repository — storage for Rung-0 composed hypotheses.
 *
 * Every function takes an Owner and scopes by ownerKey. There is deliberately
 * no "list all leads" call: leads are private by construction, and a helper
 * that forgets the owner is how private pools leak.
 */
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { leads } from '../db/schema';
import type { LeadDraft } from './compose';

export interface Owner {
  /** AuthContext.rateKey — the stable identity of this pool. */
  ownerKey: string;
  /** Null for anonymous callers; their leads expire. */
  userId: number | null;
}

export interface LeadRow {
  id: number;
  slug: string;
  title: string;
  thesisSkeleton: string;
  sector: string | null;
  primitiveRefs: string[];
  evidenceSnapshot: { ref: string; type: string; label: string }[];
  wedge: Record<string, string>;
  heuristicScore: number;
  combinationIndex: number;
  stage: 'composed' | 'refined';
  opportunityId: number | null;
  createdAt: Date;
  dismissedAt: Date | null;
  dismissReason: string | null;
}

/** Anonymous pools are ephemeral — no durable identity owns them. */
const ANON_TTL_DAYS = 7;

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type Row = typeof leads.$inferSelect;

function toLead(r: Row): LeadRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    thesisSkeleton: r.thesisSkeleton,
    sector: r.sector,
    primitiveRefs: parse<string[]>(r.primitiveRefs, []),
    evidenceSnapshot: parse<{ ref: string; type: string; label: string }[]>(r.evidenceSnapshot, []),
    wedge: parse<Record<string, string>>(r.wedge, {}),
    heuristicScore: r.heuristicScore,
    combinationIndex: r.combinationIndex,
    stage: r.stage,
    opportunityId: r.opportunityId,
    createdAt: r.createdAt,
    dismissedAt: r.dismissedAt,
    dismissReason: r.dismissReason,
  };
}

/** Persist drafts for this owner. Existing slugs are left untouched. */
export function insertLeads(owner: Owner, drafts: LeadDraft[]): LeadRow[] {
  const db = getDb();
  const now = new Date();
  const expiresAt = owner.userId == null ? new Date(now.getTime() + ANON_TTL_DAYS * 864e5) : null;
  const out: LeadRow[] = [];

  for (const d of drafts) {
    const prior = db
      .select()
      .from(leads)
      .where(and(eq(leads.ownerKey, owner.ownerKey), eq(leads.slug, d.slug)))
      .get();
    if (prior) {
      out.push(toLead(prior));
      continue;
    }
    const inserted = db
      .insert(leads)
      .values({
        ownerKey: owner.ownerKey,
        ownerUserId: owner.userId,
        slug: d.slug,
        title: d.title,
        thesisSkeleton: d.thesisSkeleton,
        sector: d.sector,
        primitiveRefs: JSON.stringify(d.primitiveRefs),
        evidenceSnapshot: JSON.stringify(d.evidenceSnapshot ?? []),
        wedge: JSON.stringify(d.wedge),
        heuristicScore: d.heuristicScore,
        combinationIndex: d.combinationIndex,
        createdAt: now,
        expiresAt,
      })
      .returning()
      .get();
    if (inserted) out.push(toLead(inserted));
  }
  return out;
}

export interface LeadPage {
  leads: LeadRow[];
  nextCursor: number | null;
}

/** This owner's undismissed leads, strongest heuristic first. */
export function listLeads(
  owner: Owner,
  opts: { limit: number; cursor?: number; sector?: string },
): LeadPage {
  const db = getDb();
  const cursor = opts.cursor ?? 0;
  const conds = [eq(leads.ownerKey, owner.ownerKey), isNull(leads.dismissedAt)];
  if (opts.sector) conds.push(eq(leads.sector, opts.sector));

  // fetch one extra to decide whether another page exists
  const rows = db
    .select()
    .from(leads)
    .where(and(...conds))
    .orderBy(desc(leads.heuristicScore), desc(leads.id))
    .limit(opts.limit + 1)
    .offset(cursor)
    .all();

  const page = rows.slice(0, opts.limit);
  return {
    leads: page.map(toLead),
    nextCursor: rows.length > opts.limit ? cursor + page.length : null,
  };
}

/** One lead by slug, scoped to the owner. Null when it is not theirs. */
export function getLead(owner: Owner, slug: string): LeadRow | null {
  const row = getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.ownerKey, owner.ownerKey), eq(leads.slug, slug)))
    .get();
  return row ? toLead(row) : null;
}

/** Hide a lead and record why. False when the slug is not this owner's. */
export function dismissLead(owner: Owner, slug: string, reason: string): boolean {
  const res = getDb()
    .update(leads)
    .set({ dismissedAt: new Date(), dismissReason: reason.slice(0, 200) })
    .where(and(eq(leads.ownerKey, owner.ownerKey), eq(leads.slug, slug)))
    .run();
  return res.changes > 0;
}

/** Promote: link the lead to the opportunity Rung 1 produced from it. */
export function markRefined(leadId: number, opportunityId: number): void {
  getDb()
    .update(leads)
    .set({ stage: 'refined', opportunityId })
    .where(eq(leads.id, leadId))
    .run();
}

/** This owner's dismissed slugs, for excluding them from fresh composition. */
export function dismissedSlugs(owner: Owner): Set<string> {
  const rows = getDb()
    .select({ slug: leads.slug })
    .from(leads)
    .where(and(eq(leads.ownerKey, owner.ownerKey), isNotNull(leads.dismissedAt)))
    .all();
  return new Set(rows.map((r) => r.slug));
}

/** Sweep expired anonymous leads. Signed-in leads have a NULL expiry and survive. */
export function expireLeads(now: Date = new Date()): number {
  const res = getDb()
    .delete(leads)
    .where(and(isNotNull(leads.expiresAt), lt(leads.expiresAt, now)))
    .run();
  return res.changes;
}

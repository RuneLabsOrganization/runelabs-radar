import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { getDb } from './db';
import { batchItems, batchRunItems, batchRuns, batches, opportunities } from './db/schema';
import { can } from './entitlements';
import { runDebate } from './opportunities/critic';
import { proposeOpportunities, type ScoutConstraints } from './opportunities/engine';
import { persistScoutDrafts } from './opportunities/persist-scout';
import { publicOnly, visibleTo } from './opportunities/scope';
import { generatePlan } from './plans/generate';
import { getProfile } from './personalization';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** better-sqlite3 surfaces constraint failures as a SqliteError with a string code; drizzle passes it through untouched. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export function listBatchesForUser(userId: number | null) {
  const db = getDb();
  const drops = db
    .select()
    .from(batches)
    .where(eq(batches.kind, 'drop'))
    .orderBy(desc(batches.createdAt))
    .limit(12)
    .all();
  if (userId == null) return drops;
  const mine = db
    .select()
    .from(batches)
    .where(eq(batches.ownerId, userId))
    .orderBy(desc(batches.updatedAt))
    .all();
  const seen = new Set(mine.map((b) => b.id));
  return [...mine, ...drops.filter((d) => !seen.has(d.id))];
}

export type Batch = typeof batches.$inferSelect;

/**
 * Object-level access rules — every batch read/write surface (hub page, API
 * routes, MCP tools) must go through these. `private` batches are owner-only;
 * `members` drops require a signed-in user; system drops (ownerId null) are
 * read-only for everyone and writable by no one.
 */
export function canViewBatch(batch: Batch, userId: number | null): boolean {
  if (batch.visibility === 'public') return true;
  if (batch.visibility === 'members') return userId != null;
  return batch.ownerId != null && batch.ownerId === userId;
}

export function canModifyBatch(batch: Batch, userId: number): boolean {
  return batch.ownerId === userId;
}

export function getBatchBySlug(slug: string) {
  return getDb().select().from(batches).where(eq(batches.slug, slug)).get() ?? null;
}

export function getBatchItems(batchId: number) {
  return getDb()
    .select()
    .from(batchItems)
    .where(eq(batchItems.batchId, batchId))
    .orderBy(asc(batchItems.position))
    .all();
}

export function createWorkspaceBatch(userId: number, title: string, description?: string) {
  const gate = can({ id: userId }, 'batch_create');
  if (!gate.ok) throw new Error(gate.reason ?? 'Batch limit reached');
  const now = new Date();
  const base = slugify(title) || `batch-${Date.now()}`;
  const db = getDb();
  // Two concurrent creates with the same title race the unique batches.slug:
  // a check-then-insert lets both pass the check and the loser 500s on the
  // constraint. Attempt the insert and fall back to a timestamp suffix once.
  for (const slug of [base, `${base}-${Date.now().toString(36)}`]) {
    try {
      return db
        .insert(batches)
        .values({
          ownerId: userId,
          kind: 'workspace',
          slug,
          title,
          description: description ?? null,
          visibility: 'private',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  // the suffixed retry raced a third writer with the same millisecond suffix
  throw new Error('Batch slug conflict — please retry');
}

export function addToBatch(
  batchId: number,
  item: {
    refType: 'opportunity' | 'story' | 'entity' | 'idea';
    refId?: number;
    refKey?: string;
    ideaText?: string;
  },
) {
  const db = getDb();
  const existing = getBatchItems(batchId);
  const row = db
    .insert(batchItems)
    .values({
      batchId,
      refType: item.refType,
      refId: item.refId ?? null,
      refKey: item.refKey ?? null,
      ideaText: item.ideaText ?? null,
      position: existing.length,
      createdAt: new Date(),
    })
    .returning()
    .get();
  db.update(batches).set({ updatedAt: new Date() }).where(eq(batches.id, batchId)).run();
  return row;
}

/** A 'running' batch run younger than this is owned by a live process — same freshness semantics as RUNNING_FRESH_MS for job_runs (jobs.ts). */
export const BATCH_RUN_FRESH_MS = 30 * 60 * 1000;

/**
 * Reap batch_runs rows stuck 'running' because a process died mid-loop —
 * job_runs has this reaper in withJobRun; batch_runs had none, so a crash
 * left the row 'running' forever. Called at the top of runBatchOp.
 */
export function reapStaleBatchRuns(): number {
  const db = getDb();
  return db
    .update(batchRuns)
    .set({ status: 'error', finishedAt: new Date(), error: 'stale running row reaped — process died mid-run' })
    .where(and(eq(batchRuns.status, 'running'), lt(batchRuns.createdAt, new Date(Date.now() - BATCH_RUN_FRESH_MS))))
    .run().changes;
}

export async function runBatchOp(batchId: number, op: 'debate' | 'plan' | 'scout', userId: number) {
  const gate = can({ id: userId }, 'batch_run');
  if (!gate.ok) throw new Error(gate.reason ?? 'Bulk runs require Builder');

  const db = getDb();
  // a previous run may have died mid-loop — reap it before recording this one
  reapStaleBatchRuns();
  const items = getBatchItems(batchId);
  const run = db
    .insert(batchRuns)
    .values({
      batchId,
      op,
      status: 'running',
      requestedBy: userId,
      createdAt: new Date(),
    })
    .returning()
    .get();

  let ok = 0;
  let error = 0;
  for (const item of items) {
    const ri = db
      .insert(batchRunItems)
      .values({ runId: run.id, batchItemId: item.id, status: 'running' })
      .returning()
      .get();
    try {
      // Quota is consumed per item — one pre-loop check would let a 100-item
      // batch burn 100 generations on a single remaining unit.
      const opGate = can({ id: userId }, op);
      if (!opGate.ok) throw new Error(opGate.reason ?? `${op} quota reached`);
      let resultRef: string | null = null;
      if (op === 'debate') {
        const idea =
          item.ideaText ??
          (item.refType === 'opportunity' && item.refId ? undefined : item.refKey ?? 'untitled idea');
        const res = await runDebate(item.refType === 'opportunity' ? item.refId ?? null : null, idea, userId);
        resultRef = String(res.id);
      } else if (op === 'plan') {
        let oppId: number | null = item.refId ?? null;
        if (!oppId && item.refKey) {
          oppId =
            db
              .select()
              .from(opportunities)
              .where(and(eq(opportunities.slug, item.refKey), visibleTo(userId)))
              .orderBy(desc(opportunities.ownerUserId))
              .get()?.id ?? null;
        }
        if (!oppId) throw new Error('Plan requires an opportunity');
        const res = await generatePlan(oppId, { userId });
        if (!res.ok) throw new Error(res.error);
        resultRef = String(oppId);
      } else {
        // scout: run proposer with profile/item constraints and persist openings
        const profile = getProfile(userId);
        const constraints: ScoutConstraints = {};
        if (profile?.skills.length) constraints.skills = profile.skills.join(', ');
        if (profile?.interests[0]) constraints.sector = profile.interests[0];
        if (profile?.capitalBand) constraints.capital = profile.capitalBand;
        if (item.ideaText) constraints.skills = (constraints.skills ? constraints.skills + '; ' : '') + item.ideaText;
        if (item.refType === 'opportunity' && item.refKey) constraints.sector = item.refKey;
        const { drafts } = await proposeOpportunities(
          Object.keys(constraints).length ? constraints : undefined,
        );
        const { persisted } = persistScoutDrafts(drafts, userId);
        resultRef = persisted.map((p) => p.slug).join(',') || 'scout-empty';
      }
      db.update(batchRunItems)
        .set({ status: 'ok', resultRef, finishedAt: new Date() })
        .where(eq(batchRunItems.id, ri.id))
        .run();
      ok += 1;
    } catch (e) {
      error += 1;
      db.update(batchRunItems)
        .set({
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
          finishedAt: new Date(),
        })
        .where(eq(batchRunItems.id, ri.id))
        .run();
    }
  }

  db.update(batchRuns)
    .set({
      status: error && !ok ? 'error' : 'ok',
      stats: JSON.stringify({ total: items.length, ok, error }),
      finishedAt: new Date(),
    })
    .where(eq(batchRuns.id, run.id))
    .run();

  return db.select().from(batchRuns).where(eq(batchRuns.id, run.id)).get()!;
}

/** Weekly Radar Batch drop — top pursue opportunities of the week. */
export async function createWeeklyRadarDrop(): Promise<{ slug: string; count: number }> {
  const db = getDb();
  const now = new Date();
  const week = getIsoWeek(now);
  const cohort = `${now.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  const slug = `radar-${cohort.toLowerCase()}`;
  const existing = db.select().from(batches).where(eq(batches.slug, slug)).get();
  if (existing) return { slug, count: getBatchItems(existing.id).length };

  const tops = db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.status, 'active'),
        eq(opportunities.verdict, 'pursue'),
        publicOnly(),
      ),
    )
    .orderBy(desc(opportunities.flipScore))
    .limit(10)
    .all();

  const batch = db
    .insert(batches)
    .values({
      ownerId: null,
      kind: 'drop',
      slug,
      title: `Radar Batch ${cohort}`,
      cohort,
      visibility: 'members',
      description: 'Weekly curated pursue-grade openings.',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  tops.forEach((o, i) => {
    db.insert(batchItems)
      .values({
        batchId: batch.id,
        refType: 'opportunity',
        refId: o.id,
        refKey: o.slug,
        position: i,
        createdAt: now,
      })
      .run();
  });

  return { slug, count: tops.length };
}

function getIsoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
}

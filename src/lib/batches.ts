import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { batchItems, batchRunItems, batchRuns, batches, debates, opportunities } from './db/schema';
import { can } from './entitlements';
import { runDebate } from './opportunities/critic';
import { generatePlan } from './plans/generate';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
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
  let slug = slugify(title) || `batch-${Date.now()}`;
  const db = getDb();
  if (db.select().from(batches).where(eq(batches.slug, slug)).get()) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }
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

export async function runBatchOp(batchId: number, op: 'debate' | 'plan' | 'scout', userId: number) {
  const gate = can({ id: userId }, 'batch_run');
  if (!gate.ok) throw new Error(gate.reason ?? 'Bulk runs require Builder');
  if (op === 'plan') {
    const pg = can({ id: userId }, 'plan');
    if (!pg.ok) throw new Error(pg.reason ?? 'Plan quota reached');
  }
  if (op === 'debate') {
    const dg = can({ id: userId }, 'debate');
    if (!dg.ok) throw new Error(dg.reason ?? 'Debate quota reached');
  }

  const db = getDb();
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
      let resultRef: string | null = null;
      if (op === 'debate') {
        const idea =
          item.ideaText ??
          (item.refType === 'opportunity' && item.refId ? undefined : item.refKey ?? 'untitled idea');
        await runDebate(item.refType === 'opportunity' ? item.refId ?? null : null, idea);
        const last = db.select({ id: debates.id }).from(debates).orderBy(desc(debates.id)).limit(1).get();
        resultRef = last ? String(last.id) : null;
      } else if (op === 'plan') {
        let oppId: number | null = item.refId ?? null;
        if (!oppId && item.refKey) {
          oppId = db.select().from(opportunities).where(eq(opportunities.slug, item.refKey)).get()?.id ?? null;
        }
        if (!oppId) throw new Error('Plan requires an opportunity');
        const res = await generatePlan(oppId, { userId });
        if (!res.ok) throw new Error(res.error);
        resultRef = String(oppId);
      } else {
        resultRef = 'scout-queued';
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
    .where(and(eq(opportunities.status, 'active'), eq(opportunities.verdict, 'pursue')))
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

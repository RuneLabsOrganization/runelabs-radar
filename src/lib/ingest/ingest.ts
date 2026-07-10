import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { items, sources } from '../db/schema';
import { adapters } from './adapters';

export type IngestStats = {
  sourcesOk: number;
  sourcesFailed: number;
  newItems: number;
};

/**
 * Fetch all enabled sources through their adapters and insert new items
 * (deduped by unique url via INSERT OR IGNORE). Per-source failures update
 * that source's health columns and never abort the batch.
 */
export async function runIngest(): Promise<IngestStats> {
  const db = getDb();
  const enabled = db.select().from(sources).where(eq(sources.enabled, true)).all();

  let sourcesOk = 0;
  let sourcesFailed = 0;
  let newItems = 0;

  for (const source of enabled) {
    const now = new Date();
    try {
      const adapter = adapters[source.type];
      const fetched = await adapter.fetchItems(source);

      let inserted = 0;
      for (const item of fetched) {
        const result = db
          .insert(items)
          .values({
            sourceId: source.id,
            url: item.url,
            title: item.title,
            excerpt: item.excerpt,
            publishedAt: item.publishedAt,
            fetchedAt: now,
          })
          .onConflictDoNothing()
          .run();
        inserted += result.changes;
      }

      newItems += inserted;
      sourcesOk += 1;
      db.update(sources)
        .set({
          lastFetchedAt: now,
          lastStatus: `ok (${fetched.length} fetched, ${inserted} new)`,
          consecutiveFailures: 0,
        })
        .where(eq(sources.id, source.id))
        .run();
    } catch (e) {
      sourcesFailed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[ingest] source "${source.name}" failed: ${message}`);
      db.update(sources)
        .set({
          lastFetchedAt: now,
          lastStatus: `error: ${message}`.slice(0, 500),
          consecutiveFailures: source.consecutiveFailures + 1,
        })
        .where(eq(sources.id, source.id))
        .run();
    }
  }

  return { sourcesOk, sourcesFailed, newItems };
}

import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { items, sources } from '../db/schema';
import { adapters } from './adapters';

export type IngestStats = {
  sourcesOk: number;
  sourcesFailed: number;
  sourcesSkipped: number;
  newItems: number;
};

/** Default per-source poll cadence when the config sets none. */
export const DEFAULT_POLL_MINUTES = 30;
/** Concurrent adapter fetches; adapters with internal queues (reddit) stay serial. */
const INGEST_CONCURRENCY = 4;

type SourceRow = typeof sources.$inferSelect;

/**
 * Minutes between polls for a source: config.pollMinutes, falling back to
 * pollHours*60 (the seeded Brave configs), then the global default.
 */
export function pollMinutesFor(cfg: Record<string, unknown>): number {
  const minutes = Number(cfg.pollMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes;
  const hours = Number(cfg.pollHours);
  if (Number.isFinite(hours) && hours > 0) return hours * 60;
  return DEFAULT_POLL_MINUTES;
}

/** Lenient config parse for cadence reads; malformed JSON is the adapter's job to reject. */
function readConfig(config: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(config);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Fetch every DUE enabled source through its adapter and insert new items
 * (deduped by unique url via INSERT OR IGNORE). A source is due when
 * lastFetchedAt is older than its pollMinutes cadence; skipped sources are
 * NOT stamped — lastFetchedAt only moves on real fetch attempts, so cadence
 * throttling actually engages (the previous stamp-on-skip behavior locked
 * throttled sources into never fetching again).
 * Per-source failures update that source's health columns and never abort
 * the batch. Sources are fetched with bounded concurrency.
 */
export async function runIngest(): Promise<IngestStats> {
  const db = getDb();
  const enabled = db.select().from(sources).where(eq(sources.enabled, true)).all();
  const now = Date.now();

  const due: SourceRow[] = [];
  let sourcesSkipped = 0;
  for (const source of enabled) {
    const pollMs = pollMinutesFor(readConfig(source.config)) * 60_000;
    if (source.lastFetchedAt && now - source.lastFetchedAt.getTime() < pollMs) {
      sourcesSkipped += 1;
      continue;
    }
    due.push(source);
  }

  let sourcesOk = 0;
  let sourcesFailed = 0;
  let newItems = 0;

  async function ingestOne(source: SourceRow): Promise<void> {
    const now = new Date();
    try {
      const adapter = adapters[source.type];
      // adapters may mutate cfg to persist fetch state (etag/lastModified)
      const cfg = readConfig(source.config);
      const fetched = await adapter.fetchItems(source, cfg);

      let inserted = 0;
      for (const item of fetched) {
        // Item URLs render into <a href> across the hub — never store
        // non-http(s) schemes (javascript:, data:, ...) from feeds.
        if (!/^https?:\/\//i.test(item.url)) continue;
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
          // persist adapter-mutated fetch state (etag/lastModified round-trip)
          config: JSON.stringify(cfg),
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

  // bounded-parallel pool: 4 workers pull sources off the shared index
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(INGEST_CONCURRENCY, due.length) }, async () => {
      while (idx < due.length) {
        const source = due[idx++];
        await ingestOne(source);
      }
    }),
  );

  return { sourcesOk, sourcesFailed, sourcesSkipped, newItems };
}

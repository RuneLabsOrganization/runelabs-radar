import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources } from '@/lib/db/schema';
import { _setSleepForTests } from '@/lib/ingest/adapters/shared';
import { runIngest } from '@/lib/ingest/ingest';
import { useTestDb } from './helpers/db';

const FEED_URL = 'https://config.example.com/feed.xml';

const TINY_FEED =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
  '<item><title>One</title><link>https://config.example.com/1</link></item>' +
  '</channel></rss>';

beforeEach(() => {
  _setSleepForTests(() => Promise.resolve());
});

afterEach(() => {
  vi.unstubAllGlobals();
  _setSleepForTests(null);
});

describe('runIngest config write-back (I5)', () => {
  it('an admin config edit landing mid-fetch survives; fetch state still persists', async () => {
    useTestDb();
    const db = getDb();
    const source = db
      .insert(sources)
      .values({ type: 'rss', name: 'Config Race', config: JSON.stringify({ url: FEED_URL, pollMinutes: 15 }) })
      .returning()
      .get();

    // the admin PATCH lands while the fetch is in flight (between the
    // orchestrator's config read and its write-back)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        db.update(sources)
          .set({ config: JSON.stringify({ url: FEED_URL, pollMinutes: 5, notes: 'admin edit' }) })
          .where(eq(sources.id, source.id))
          .run();
        return new Response(TINY_FEED, { status: 200, headers: { etag: '"v9"' } });
      }),
    );

    const stats = await runIngest();
    expect(stats.sourcesOk).toBe(1);

    const after = db.select().from(sources).where(eq(sources.id, source.id)).get()!;
    const config = JSON.parse(after.config) as Record<string, unknown>;
    // admin's concurrent edit is preserved…
    expect(config.pollMinutes).toBe(5);
    expect(config.notes).toBe('admin edit');
    // …and the adapter-owned fetch state was still written
    expect(config.etag).toBe('"v9"');
    expect(config.url).toBe(FEED_URL);
    expect(after.lastStatus).toMatch(/^ok/);
  });

  it('a dropped etag is removed from the merged config without touching other keys', async () => {
    useTestDb();
    const db = getDb();
    const source = db
      .insert(sources)
      .values({
        type: 'rss',
        name: 'Etag Drop',
        config: JSON.stringify({ url: FEED_URL, pollMinutes: 15, etag: '"old"', lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT' }),
      })
      .returning()
      .get();

    // the feed stops sending validators → the adapter deletes them from cfg
    vi.stubGlobal('fetch', vi.fn(async () => new Response(TINY_FEED, { status: 200 })));

    await runIngest();

    const after = db.select().from(sources).where(eq(sources.id, source.id)).get()!;
    const config = JSON.parse(after.config) as Record<string, unknown>;
    expect(config.etag).toBeUndefined();
    expect(config.lastModified).toBeUndefined();
    expect(config.pollMinutes).toBe(15);
    expect(config.url).toBe(FEED_URL);
  });
});

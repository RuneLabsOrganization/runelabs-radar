import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { sources } from '@/lib/db/schema';
import { classifySourceHealth } from '@/lib/ingest/health';
import { runIngest } from '@/lib/ingest/ingest';
import { useTestDb } from './helpers/db';

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Item A</title><link>https://example.com/a</link></item>
</channel></rss>`;

const FEED_PLUS = FEED.replace(
  '</channel>',
  '<item><title>Item B</title><link>https://example.com/b</link></item></channel>',
);

function stubFetch(body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } })),
  );
}

function seedFeed(): void {
  getDb()
    .insert(sources)
    .values({
      type: 'rss',
      name: 'test-feed',
      config: JSON.stringify({ url: 'https://example.com/feed' }),
    })
    .run();
}

/** Clear the cadence throttle so the next runIngest actually fetches. */
function makeDue(): void {
  getDb().update(sources).set({ lastFetchedAt: null }).run();
}

function streak(): number {
  return getDb().select().from(sources).get()!.consecutiveEmpty;
}

describe('empty-poll streak', () => {
  beforeEach(() => useTestDb());
  afterEach(() => vi.unstubAllGlobals());

  it('stays 0 when a poll yields new items', async () => {
    seedFeed();
    stubFetch(FEED);
    await runIngest();
    expect(streak()).toBe(0);
  });

  it('increments when a poll fetches fine but yields nothing new', async () => {
    seedFeed();
    stubFetch(FEED);
    await runIngest();

    makeDue();
    await runIngest();
    expect(streak()).toBe(1);

    makeDue();
    await runIngest();
    expect(streak()).toBe(2);
  });

  it('resets to 0 as soon as a new item lands', async () => {
    seedFeed();
    stubFetch(FEED);
    await runIngest();
    makeDue();
    await runIngest();
    expect(streak()).toBe(1);

    makeDue();
    stubFetch(FEED_PLUS);
    await runIngest();
    expect(streak()).toBe(0);
  });
});

function row(over: Partial<{ consecutiveFailures: number; consecutiveEmpty: number; lastFetchedAt: Date | null }>) {
  return { consecutiveFailures: 0, consecutiveEmpty: 0, lastFetchedAt: new Date(), ...over };
}

describe('classifySourceHealth', () => {
  it('is ok for a fetching, yielding source', () => {
    expect(classifySourceHealth(row({})).health).toBe('ok');
  });

  it('is failing after 3 consecutive errors', () => {
    expect(classifySourceHealth(row({ consecutiveFailures: 3 })).health).toBe('failing');
  });

  it('is dead after 10 consecutive errors', () => {
    expect(classifySourceHealth(row({ consecutiveFailures: 10 })).health).toBe('dead');
  });

  it('is stale when fetching fine but publishing nothing', () => {
    const v = classifySourceHealth(row({ consecutiveEmpty: 20 }));
    expect(v.health).toBe('stale');
    expect(v.reason).toContain('no new items');
  });

  it('ranks errors above staleness when both are tripped', () => {
    expect(classifySourceHealth(row({ consecutiveFailures: 10, consecutiveEmpty: 40 })).health).toBe('dead');
  });

  it('treats a never-fetched source as ok, not stale', () => {
    expect(classifySourceHealth(row({ lastFetchedAt: null })).health).toBe('ok');
  });
});

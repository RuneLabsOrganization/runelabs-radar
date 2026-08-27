import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { items, sourceQuality, sources, stories } from '@/lib/db/schema';
import { sourceVerdict, type SourceWindowStats } from '@/lib/ingest/quality';
import { runSourceReview } from '@/lib/ingest/review';
import { useTestDb } from './helpers/db';

function stats(over: Partial<SourceWindowStats> = {}): SourceWindowStats {
  return { fetched: 200, used: 20, curated: 10, meanTopScore: 60, meanHindsight: 30, ...over };
}

describe('sourceVerdict', () => {
  it('keeps a source with healthy yield', () => {
    expect(sourceVerdict(stats()).verdict).toBe('keep');
  });

  it('watches a source with too small a sample to judge', () => {
    const v = sourceVerdict(stats({ fetched: 5 }));
    expect(v.verdict).toBe('watch');
    expect(v.reason).toContain('too few');
  });

  it('drops a source whose items never reach a curated story', () => {
    const v = sourceVerdict(stats({ used: 0, curated: 0 }));
    expect(v.verdict).toBe('drop');
    expect(v.reason).toContain('none reached');
  });

  it('demotes a high-volume low-yield source', () => {
    expect(sourceVerdict(stats({ fetched: 5000, used: 40, curated: 3 })).verdict).toBe('demote');
  });

  it('watches a source whose curated items go nowhere', () => {
    const v = sourceVerdict(stats({ meanHindsight: 4 }));
    expect(v.verdict).toBe('watch');
    expect(v.reason).toContain('hindsight');
  });

  it('does not punish a source that simply has no hindsight data yet', () => {
    expect(sourceVerdict(stats({ meanHindsight: null })).verdict).toBe('keep');
  });
});

describe('runSourceReview', () => {
  beforeEach(() => useTestDb());

  it('rolls up per-source stats and persists a verdict', async () => {
    const db = getDb();
    const sourceId = db
      .insert(sources)
      .values({ type: 'rss', name: 'noisy-feed', config: '{}' })
      .returning({ id: sources.id })
      .get().id;

    const storyId = db
      .insert(stories)
      .values({ title: 'A curated story', status: 'curated', topScore: 70, hindsight: 40, createdAt: new Date() })
      .returning({ id: stories.id })
      .get().id;

    // 30 items, 3 of which reached the curated story
    for (let i = 0; i < 30; i++) {
      db.insert(items)
        .values({
          sourceId,
          url: `https://example.com/${i}`,
          title: `item ${i}`,
          excerpt: null,
          publishedAt: null,
          fetchedAt: new Date(),
          storyId: i < 3 ? storyId : null,
        })
        .run();
    }

    const out = await runSourceReview();
    expect(out.reviewed).toBe(1);

    const row = db.select().from(sourceQuality).get()!;
    expect(row.fetched).toBe(30);
    expect(row.used).toBe(3);
    expect(row.curated).toBe(3);
    expect(row.meanHindsight).toBe(40);
    expect(row.verdict).toBe('keep');
  });

  it('is idempotent — a second run in the same window does not duplicate rows', async () => {
    const db = getDb();
    db.insert(sources).values({ type: 'rss', name: 'quiet-feed', config: '{}' }).run();
    await runSourceReview();
    await runSourceReview();
    expect(db.select().from(sourceQuality).all()).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, type Db } from '@/lib/db';
import { items, sourceQuality, sources, stories } from '@/lib/db/schema';
import { runSourceReview } from '@/lib/ingest/review';
import { useTestDb } from './helpers/db';

let db: Db;
let sourceId: number;

beforeEach(() => {
  db = useTestDb();
  sourceId = db
    .insert(sources)
    .values({ type: 'rss', name: 'skew-feed', config: '{}' })
    .returning({ id: sources.id })
    .get().id;
});

function addCuratedStory(title: string, topScore: number, hindsight: number | null, itemCount: number) {
  const storyId = db
    .insert(stories)
    .values({ title, status: 'curated', topScore, hindsight, createdAt: new Date() })
    .returning({ id: stories.id })
    .get().id;
  for (let i = 0; i < itemCount; i++) {
    db.insert(items)
      .values({
        sourceId,
        url: `https://example.com/${title.replace(/\s/g, '-')}/${i}`,
        title: `${title} item ${i}`,
        fetchedAt: new Date(),
        storyId,
      })
      .run();
  }
}

describe('runSourceReview mean weighting (I11)', () => {
  it('meanTopScore weights stories, not items — duplicated coverage does not skew the mean', async () => {
    // story A: one feed covering it 3× at score 90; story B: once at score 30.
    // per-item mean would be (90·3+30)/4 = 75; per-story mean is (90+30)/2 = 60.
    addCuratedStory('big story', 90, null, 3);
    addCuratedStory('small story', 30, null, 1);

    await runSourceReview();

    const row = db.select().from(sourceQuality).get()!;
    expect(row.meanTopScore).toBe(60);
    // item-level counts are unaffected: yield still measures items
    expect(row.fetched).toBe(4);
    expect(row.used).toBe(4);
    expect(row.curated).toBe(4);
  });

  it('meanHindsight weights stories the same way', async () => {
    addCuratedStory('echoed story', 50, 80, 3);
    addCuratedStory('quiet story', 50, 20, 1);

    await runSourceReview();

    const row = db.select().from(sourceQuality).get()!;
    // per-item would be (80·3+20)/4 = 65
    expect(row.meanHindsight).toBe(50);
  });

  it('a story covered twice by the same source keeps the story values once', async () => {
    addCuratedStory('solo story', 70, 40, 2);

    await runSourceReview();

    const row = db.select().from(sourceQuality).get()!;
    expect(row.meanTopScore).toBe(70);
    expect(row.meanHindsight).toBe(40);
  });
});

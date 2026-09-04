import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { items, sourceQuality, sources, stories } from '@/lib/db/schema';
import { sourceVerdict, type SourceWindowStats } from '@/lib/ingest/quality';
import { runSourceReview } from '@/lib/ingest/review';
import { useTestDb } from './helpers/db';

function stats(over: Partial<SourceWindowStats> = {}): SourceWindowStats {
  return {
    fetched: 200,
    used: 20,
    curated: 10,
    pending: 0,
    graded: 5,
    sourceAgeDays: 30,
    meanTopScore: 60,
    meanHindsight: 30,
    ...over,
  };
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

  it('honors a cadence-scaled sample bar (weekly newsletter is judgeable at 6 items)', () => {
    // with the default MIN_SAMPLE=20 this source would sit in 'watch' forever
    const v = sourceVerdict(stats({ fetched: 6, used: 2, curated: 1, minSample: 4 }));
    expect(v.verdict).toBe('keep');
  });

  it('drops a source whose items never reach a curated story — once the pipeline had a fair chance', () => {
    const v = sourceVerdict(stats({ used: 0, curated: 0 }));
    expect(v.verdict).toBe('drop');
    expect(v.reason).toContain('none reached');
  });

  it('does NOT drop a fresh source with zero curation — backlog is not quality (E7)', () => {
    const v = sourceVerdict(stats({ used: 0, curated: 0, sourceAgeDays: 2 }));
    expect(v.verdict).toBe('watch');
    expect(v.reason).toContain('fair chance');
  });

  it('does NOT drop when most items are still inside the curation window (E7)', () => {
    const v = sourceVerdict(stats({ used: 0, curated: 0, pending: 150 }));
    expect(v.verdict).toBe('watch');
    expect(v.reason).toContain('fair chance');
  });

  it('demotes a high-volume low-yield source', () => {
    expect(sourceVerdict(stats({ fetched: 5000, used: 40, curated: 3 })).verdict).toBe('demote');
  });

  it('watches a source whose curated items go nowhere', () => {
    const v = sourceVerdict(stats({ meanHindsight: 4 }));
    expect(v.verdict).toBe('watch');
    expect(v.reason).toContain('hindsight');
  });

  it('reports insufficient data instead of a free keep when too few stories are graded (E7)', () => {
    // JUSTIFICATION for the changed expectation: a source whose stories were
    // too new to grade used to skip the hindsight check and collect 'keep' —
    // a free pass. Now too-small graded n is reported as insufficient data.
    const v = sourceVerdict(stats({ meanHindsight: null, graded: 0 }));
    expect(v.verdict).toBe('watch');
    expect(v.reason).toContain('insufficient hindsight data');
  });
});

describe('runSourceReview', () => {
  beforeEach(() => useTestDb());

  function addSource(name: string, config = '{}'): number {
    return getDb()
      .insert(sources)
      .values({ type: 'rss', name, config })
      .returning({ id: sources.id })
      .get().id;
  }

  function addItems(
    sourceId: number,
    n: number,
    opts: { storyId?: number | null; fetchedAt?: Date; salt?: string } = {},
  ) {
    const db = getDb();
    for (let i = 0; i < n; i++) {
      db.insert(items)
        .values({
          sourceId,
          url: `https://example.com/${sourceId}/${opts.salt ?? ''}${i}`,
          title: `item ${i}`,
          excerpt: null,
          publishedAt: null,
          fetchedAt: opts.fetchedAt ?? new Date(),
          storyId: opts.storyId ?? null,
        })
        .run();
    }
  }

  it('rolls up per-source stats and persists a verdict', async () => {
    const db = getDb();
    const sourceId = addSource('noisy-feed');

    // 3 curated, graded stories (E7: <3 graded is now 'watch', not a free 'keep')
    const storyIds = [40, 50, 60].map(
      (hindsight) =>
        db
          .insert(stories)
          .values({ title: `story ${hindsight}`, status: 'curated', topScore: 70, hindsight, createdAt: new Date() })
          .returning({ id: stories.id })
          .get().id,
    );

    // 30 items, one per curated story
    addItems(sourceId, 27);
    for (const storyId of storyIds) addItems(sourceId, 1, { storyId, salt: `s${storyId}-` });

    const out = await runSourceReview();
    expect(out.reviewed).toBe(1);

    const row = db.select().from(sourceQuality).get()!;
    expect(row.fetched).toBe(30);
    expect(row.used).toBe(3);
    expect(row.curated).toBe(3);
    expect(row.meanHindsight).toBe(50);
    expect(row.verdict).toBe('keep');
  });

  it('a fresh source with zero curation is watch, not drop (E7)', async () => {
    const db = getDb();
    const sourceId = addSource('fresh-feed');
    // all items fetched today — the pipeline hasn't had its 7 days
    addItems(sourceId, 30);

    await runSourceReview();
    const row = db.select().from(sourceQuality).get()!;
    expect(row.curated).toBe(0);
    expect(row.verdict).toBe('watch');
    expect(row.reason).toContain('fair chance');
  });

  it('an old source whose items are past the curation window with zero curation drops (E7)', async () => {
    const db = getDb();
    const sourceId = addSource('dead-weight');
    // fetched 20 days ago: sourceAgeDays ≈ 20 ≥ 7, nothing pending → fair chance had
    addItems(sourceId, 30, { fetchedAt: new Date(Date.now() - 20 * 86_400_000) });

    await runSourceReview();
    const row = db.select().from(sourceQuality).get()!;
    expect(row.verdict).toBe('drop');
  });

  it('a weekly-cadence source is judged on a scaled sample bar, not permanent watch (E7)', async () => {
    const db = getDb();
    const sourceId = addSource('weekly-newsletter', '{"pollHours":168}');
    // 6 items ≥ scaled bar of 4, old, nothing pending, zero curation → judged: drop
    addItems(sourceId, 6, { fetchedAt: new Date(Date.now() - 20 * 86_400_000) });

    await runSourceReview();
    const row = db.select().from(sourceQuality).get()!;
    expect(row.verdict).toBe('drop'); // with MIN_SAMPLE=20 this would have been 'watch' forever
  });

  it('curated-but-ungraded stories yield watch (insufficient data), not a free keep (E7)', async () => {
    const db = getDb();
    const sourceId = addSource('too-new-to-grade');
    const storyId = db
      .insert(stories)
      .values({ title: 'landing story', status: 'curated', topScore: 70, hindsight: null, createdAt: new Date() })
      .returning({ id: stories.id })
      .get().id;
    addItems(sourceId, 27);
    addItems(sourceId, 3, { storyId, salt: 's-' });

    await runSourceReview();
    const row = db.select().from(sourceQuality).get()!;
    expect(row.curated).toBe(3);
    expect(row.verdict).toBe('watch');
    expect(row.reason).toContain('insufficient hindsight data');
  });

  it('is idempotent — a second run in the same window does not duplicate rows', async () => {
    const db = getDb();
    db.insert(sources).values({ type: 'rss', name: 'quiet-feed', config: '{}' }).run();
    await runSourceReview();
    await runSourceReview();
    expect(db.select().from(sourceQuality).all()).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import { getDb } from '@/lib/db';
import { items, sources, stories, votes, users } from '@/lib/db/schema';
import { mergeSimilarStories, MERGE_THRESHOLD } from '@/lib/curate/dedup';
import { vecToBuffer } from '@/lib/vec';

function makeVec(seed: number[]): Float32Array {
  // 384-dim normalized vector from a short seed pattern
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = seed[i % seed.length] * (i % 7 === 0 ? 1 : 0.1);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function insertStory(opts: {
  title: string;
  topScore: number;
  createdAt: Date;
  vec: Float32Array;
}): number {
  const db = getDb();
  const row = db
    .insert(stories)
    .values({
      title: opts.title,
      status: 'curated',
      topScore: opts.topScore,
      createdAt: opts.createdAt,
      embedding: vecToBuffer(opts.vec),
    })
    .returning({ id: stories.id })
    .get();
  return row.id;
}

function insertSource(): number {
  const db = getDb();
  return db
    .insert(sources)
    .values({ type: 'rss', name: 'Test Feed', config: '{}' })
    .returning({ id: sources.id })
    .get().id;
}

function insertItem(storyId: number, url: string, sourceId: number): number {
  const db = getDb();
  return db
    .insert(items)
    .values({ sourceId, url, title: url, fetchedAt: new Date(), storyId })
    .returning({ id: items.id })
    .get().id;
}

describe('semantic dedup', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('merges near-identical stories into the older one and moves items/votes', async () => {
    const now = Date.now();
    const older = insertStory({
      title: 'OpenAI launches GPT-5.6',
      topScore: 70,
      createdAt: new Date(now - 5 * 36e5),
      vec: makeVec([1, 0.5, 0.25]),
    });
    const dupe = insertStory({
      title: 'GPT-5.6 is here',
      topScore: 85,
      createdAt: new Date(now - 1 * 36e5),
      vec: makeVec([1, 0.5, 0.25]),
    });
    const src = insertSource();
    const itemId = insertItem(dupe, 'https://example.com/a', src);

    const db = getDb();
    db.insert(users).values({ name: 'u1', passwordHash: 'x', role: 'member' }).run();
    db.insert(votes).values({ userId: 1, storyId: dupe, value: 1 }).run();

    const result = await mergeSimilarStories(now);
    expect(result.merged).toBe(1);

    // dupe gone, item + vote moved
    expect(db.select().from(stories).where(eq(stories.id, dupe)).all()).toHaveLength(0);
    expect(db.select().from(items).where(eq(items.id, itemId)).get()!.storyId).toBe(older);
    expect(db.select().from(votes).get()!.storyId).toBe(older);

    // better curated payload (higher topScore) won
    expect(db.select().from(stories).where(eq(stories.id, older)).get()!.topScore).toBe(85);
  });

  it('keeps related-but-distinct stories separate', async () => {
    const now = Date.now();
    insertStory({
      title: 'OpenAI launches GPT-5.6',
      topScore: 70,
      createdAt: new Date(now - 5 * 36e5),
      vec: makeVec([1, 0, 0]),
    });
    insertStory({
      title: 'Anthropic ships Claude Opus 5',
      topScore: 80,
      createdAt: new Date(now - 1 * 36e5),
      vec: makeVec([0, 1, 0.01]),
    });
    const result = await mergeSimilarStories(now);
    expect(result.merged).toBe(0);
    expect(getDb().select().from(stories).all()).toHaveLength(2);
  });

  it('drops the conflicting dup-side vote when a user voted on both', async () => {
    const now = Date.now();
    const vec = makeVec([0.7, 0.7]);
    const older = insertStory({ title: 'A', topScore: 50, createdAt: new Date(now - 4 * 36e5), vec });
    const dupe = insertStory({ title: 'A2', topScore: 50, createdAt: new Date(now - 2 * 36e5), vec });
    const db = getDb();
    db.insert(users).values({ name: 'u1', passwordHash: 'x', role: 'member' }).run();
    db.insert(votes).values({ userId: 1, storyId: older, value: 1 }).run();
    db.insert(votes).values({ userId: 1, storyId: dupe, value: -1 }).run();

    await mergeSimilarStories(now);
    const remaining = db.select().from(votes).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].storyId).toBe(older);
    expect(remaining[0].value).toBe(1); // the canonical-side vote survived
  });

  it('threshold is conservative', () => {
    expect(MERGE_THRESHOLD).toBeGreaterThanOrEqual(0.85);
  });
});

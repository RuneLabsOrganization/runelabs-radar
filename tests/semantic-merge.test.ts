import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
import { items, sources, stories } from '@/lib/db/schema';
import { semanticPreDedup } from '@/lib/curate/semantic-merge';
import { vecToBuffer } from '@/lib/vec';
import { useTestDb } from './helpers/db';

/** Unit-ish vector: one hot dimension — identical seeds collide at cosine 1. */
function vec(seed: number): Float32Array {
  const v = new Float32Array(384).fill(0);
  v[seed % 384] = 1;
  return v;
}

describe('semanticPreDedup', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
  });

  function seedCanonical() {
    const sourceId = db
      .insert(sources)
      .values({ type: 'rss', name: 'Feed' })
      .returning({ id: sources.id })
      .get().id;
    const canonical = db
      .insert(stories)
      .values({
        title: 'OpenAI ships GPT-5.2 with agentic tools',
        status: 'curated',
        createdAt: new Date(Date.now() - 20 * 36e5),
        embedding: vecToBuffer(vec(1)),
        topScore: 70,
      })
      .returning()
      .get();
    return { sourceId, canonical };
  }

  it('merges a reworded dupe pre-LLM: items relinked, canonical updatedAt bumped, raw row gone', async () => {
    const { sourceId, canonical } = seedCanonical();
    const dupe = db
      .insert(stories)
      .values({ title: 'GPT-5.2 launches', status: 'raw', createdAt: new Date() })
      .returning()
      .get();
    db.insert(items)
      .values({ sourceId, url: 'https://b.example/1', title: 'GPT-5.2 launches', fetchedAt: new Date(), storyId: dupe.id })
      .run();

    const res = await semanticPreDedup({ embed: async () => [vec(1)] });

    expect(res).toEqual({ embedded: 1, merged: 1 });
    expect(db.select().from(stories).where(eq(stories.id, dupe.id)).get()).toBeUndefined();
    const moved = db.select().from(items).where(eq(items.url, 'https://b.example/1')).get()!;
    expect(moved.storyId).toBe(canonical.id);
    const updated = db.select().from(stories).where(eq(stories.id, canonical.id)).get()!;
    expect(updated.updatedAt).toBeInstanceOf(Date);
  });

  it('non-matching stories survive and keep their embedding for the next run', async () => {
    seedCanonical();
    const other = db
      .insert(stories)
      .values({ title: 'New pizza oven released', status: 'raw', createdAt: new Date() })
      .returning()
      .get();

    const res = await semanticPreDedup({ embed: async () => [vec(7)] });

    expect(res).toEqual({ embedded: 1, merged: 0 });
    const survived = db.select().from(stories).where(eq(stories.id, other.id)).get()!;
    expect(survived.status).toBe('raw');
    expect(survived.embedding).not.toBeNull();
  });
});

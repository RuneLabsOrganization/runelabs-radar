import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
import { items, sources, stories } from '@/lib/db/schema';
import { semanticPreDedup } from '@/lib/curate/semantic-merge';
import { MERGE_THRESHOLD } from '@/lib/curate/dedup';
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

  it('a story with an unrepresentative FIRST item still matches via item 2/3 (E3)', async () => {
    const { sourceId } = seedCanonical();
    const dupe = db
      .insert(stories)
      .values({ title: 'GPT-5.2 launches', status: 'raw', createdAt: new Date() })
      .returning()
      .get();
    // first item is off-topic noise; the second names the actual news
    db.insert(items)
      .values({ sourceId, url: 'https://b.example/noise', title: 'Celebrity gossip roundup', fetchedAt: new Date(), storyId: dupe.id })
      .run();
    db.insert(items)
      .values({ sourceId, url: 'https://b.example/real', title: 'OpenAI ships GPT-5.2 with agentic tools', fetchedAt: new Date(), storyId: dupe.id })
      .run();

    const seenTexts: string[] = [];
    const res = await semanticPreDedup({
      embed: async (texts) => {
        seenTexts.push(...texts);
        // only a text carrying the SECOND item's title resembles the canonical
        return texts.map((t) => (t.includes('agentic tools') ? vec(1) : vec(7)));
      },
    });

    expect(res.merged).toBe(1);
    expect(db.select().from(stories).where(eq(stories.id, dupe.id)).get()).toBeUndefined();
    // the embed text carried member titles (not just the first item) and stayed bounded
    expect(seenTexts[0]).toContain('Celebrity gossip roundup');
    expect(seenTexts[0]).toContain('OpenAI ships GPT-5.2 with agentic tools');
    expect(seenTexts[0]!.length).toBeLessThanOrEqual(600);
  });

  it('a non-finite embedding is NOT persisted — embedding stays null for a retry (E3)', async () => {
    seedCanonical();
    const broken = db
      .insert(stories)
      .values({ title: 'Weird model release', status: 'raw', createdAt: new Date() })
      .returning()
      .get();
    const nanVec = vec(3);
    nanVec[10] = NaN;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await semanticPreDedup({ embed: async () => [nanVec] });

    expect(res).toEqual({ embedded: 1, merged: 0 });
    const row = db.select().from(stories).where(eq(stories.id, broken.id)).get()!;
    expect(row.status).toBe('raw');
    expect(row.embedding).toBeNull(); // NaN >= 0.87 is always false — persisting it would be dead weight
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-finite embedding'));
    warn.mockRestore();
  });

  it('the merge bar is the single exported MERGE_THRESHOLD from dedup (E1)', async () => {
    seedCanonical(); // canonical embedding = vec(1) — hot dimension at index 1
    const target = db
      .insert(stories)
      .values({ title: 'Borderline similar story', status: 'raw', createdAt: new Date() })
      .returning()
      .get();
    // cosine exactly 0.01 BELOW the shared bar → must NOT merge; 0.01 above → must
    const below = new Float32Array(384).fill(0);
    below[1] = MERGE_THRESHOLD - 0.01;
    below[2] = Math.sqrt(1 - below[1] ** 2);

    const res = await semanticPreDedup({ embed: async () => [below] });
    expect(res.merged).toBe(0);
    expect(db.select().from(stories).where(eq(stories.id, target.id)).get()!.status).toBe('raw');
  });
});

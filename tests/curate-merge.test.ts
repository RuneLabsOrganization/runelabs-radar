import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, rawSqlite, type Db } from '@/lib/db';
import { items, sources, stories, users, votes } from '@/lib/db/schema';
import { clusterNewItems } from '@/lib/curate/cluster';
import { mergeSimilarStories } from '@/lib/curate/dedup';
import { semanticPreDedup } from '@/lib/curate/semantic-merge';
import { vecToBuffer } from '@/lib/vec';
import { useTestDb } from './helpers/db';

/** Unit-ish vector: one hot dimension — identical seeds collide at cosine 1. */
function vec(seed: number): Float32Array {
  const v = new Float32Array(384).fill(0);
  v[seed % 384] = 1;
  return v;
}

/** 384-dim normalized vector from a short seed pattern (dedup merges at >= 0.87). */
function makeVec(seed: number[]): Float32Array {
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = seed[i % seed.length] * (i % 7 === 0 ? 1 : 0.1);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) v[i] /= norm;
  return v;
}

let db: Db;
let sourceId: number;

beforeEach(() => {
  db = useTestDb();
  sourceId = db
    .insert(sources)
    .values({ type: 'rss', name: 'Merge Feed' })
    .returning({ id: sources.id })
    .get().id;
});

function insertStory(opts: {
  title: string;
  status?: 'raw' | 'curated' | 'filtered';
  embedding?: Float32Array;
  topScore?: number;
  createdAt?: Date;
}) {
  return db
    .insert(stories)
    .values({
      title: opts.title,
      status: opts.status ?? 'raw',
      createdAt: opts.createdAt ?? new Date(),
      embedding: opts.embedding ? vecToBuffer(opts.embedding) : null,
      topScore: opts.topScore ?? 0,
    })
    .returning()
    .get();
}

function insertItem(title: string, url: string, storyId: number | null = null) {
  return db
    .insert(items)
    .values({ sourceId, url, title, fetchedAt: new Date(), storyId })
    .returning()
    .get();
}

describe('semanticPreDedup never merges into filtered stories (I1)', () => {
  it('a raw dupe does NOT merge into a filtered canonical — it survives instead', async () => {
    const filtered = insertStory({
      title: 'OpenAI ships GPT-5.2 with agentic tools',
      status: 'filtered',
      embedding: vec(1),
    });
    const dupe = insertStory({ title: 'GPT-5.2 launches', status: 'raw' });
    const item = insertItem('GPT-5.2 launches', 'https://m.example/1', dupe.id);

    const res = await semanticPreDedup({ embed: async () => [vec(1)] });

    expect(res).toEqual({ embedded: 1, merged: 0 });
    // raw story survives (and keeps its embedding for the next run)
    const survived = db.select().from(stories).where(eq(stories.id, dupe.id)).get()!;
    expect(survived.status).toBe('raw');
    expect(survived.embedding).not.toBeNull();
    // the filtered story is untouched and the item stays on the dupe
    expect(db.select().from(stories).where(eq(stories.id, filtered.id)).get()!.updatedAt).toBeNull();
    expect(db.select().from(items).where(eq(items.id, item.id)).get()!.storyId).toBe(dupe.id);
  });

  it('a raw dupe still merges into a raw canonical that has an embedding', async () => {
    const canonical = insertStory({ title: 'OpenAI ships GPT-5.2 with agentic tools', status: 'raw', embedding: vec(1) });
    const dupe = insertStory({ title: 'GPT-5.2 launches', status: 'raw' });
    const item = insertItem('GPT-5.2 launches', 'https://m.example/2', dupe.id);

    const res = await semanticPreDedup({ embed: async () => [vec(1)] });

    expect(res).toEqual({ embedded: 1, merged: 1 });
    expect(db.select().from(stories).where(eq(stories.id, dupe.id)).get()).toBeUndefined();
    expect(db.select().from(items).where(eq(items.id, item.id)).get()!.storyId).toBe(canonical.id);
  });
});

describe('merge sequences roll back atomically on a mid-sequence failure (I8)', () => {
  it('semanticPreDedup: a failing delete rolls back the relink and the updatedAt bump', async () => {
    const canonical = insertStory({ title: 'Canonical story', status: 'curated', embedding: vec(1), topScore: 70 });
    const dupe = insertStory({ title: 'Dupe story', status: 'raw' });
    const item = insertItem('Dupe story', 'https://m.example/3', dupe.id);
    rawSqlite(db).exec(`CREATE TRIGGER fail_story_delete BEFORE DELETE ON stories BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(semanticPreDedup({ embed: async () => [vec(1)] })).rejects.toThrow(/boom/);

    // nothing moved: item still on the dupe, dupe alive, canonical unbumped
    expect(db.select().from(items).where(eq(items.id, item.id)).get()!.storyId).toBe(dupe.id);
    expect(db.select().from(stories).where(eq(stories.id, dupe.id)).get()).toBeDefined();
    expect(db.select().from(stories).where(eq(stories.id, canonical.id)).get()!.updatedAt).toBeNull();
  });

  it('mergeSimilarStories: a failing delete leaves votes and items on the dupe', async () => {
    const now = Date.now();
    const shared = makeVec([1, 0.5, 0.25]);
    const older = insertStory({
      title: 'OpenAI launches GPT-5.6',
      status: 'curated',
      topScore: 70,
      createdAt: new Date(now - 5 * 36e5),
      embedding: shared,
    });
    const dupe = insertStory({
      title: 'GPT-5.6 is here',
      status: 'curated',
      topScore: 85,
      createdAt: new Date(now - 1 * 36e5),
      embedding: shared,
    });
    const item = insertItem('https://m.example/4', 'https://m.example/4', dupe.id);
    db.insert(users).values({ name: 'u1', passwordHash: 'x', role: 'member' }).run();
    db.insert(votes).values({ userId: 1, storyId: dupe.id, value: 1 }).run();
    rawSqlite(db).exec(`CREATE TRIGGER fail_story_delete BEFORE DELETE ON stories BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(mergeSimilarStories(now)).rejects.toThrow(/boom/);

    // votes untouched, item not relinked, dupe not deleted, payload not swapped
    expect(db.select().from(votes).get()!.storyId).toBe(dupe.id);
    expect(db.select().from(items).where(eq(items.id, item.id)).get()!.storyId).toBe(dupe.id);
    expect(db.select().from(stories).where(eq(stories.id, dupe.id)).get()).toBeDefined();
    expect(db.select().from(stories).where(eq(stories.id, older.id)).get()!.topScore).toBe(70);
  });

  it('clusterNewItems: a failing item link leaves no orphan story behind', async () => {
    const item = insertItem('Lonely unclustered item', 'https://m.example/5');
    rawSqlite(db).exec(`CREATE TRIGGER fail_item_update BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(clusterNewItems()).rejects.toThrow(/boom/);

    // the inserted story rolled back and the item is still unclustered
    expect(db.select().from(stories).all()).toHaveLength(0);
    expect(db.select().from(items).where(eq(items.id, item.id)).get()!.storyId).toBeNull();
  });
});

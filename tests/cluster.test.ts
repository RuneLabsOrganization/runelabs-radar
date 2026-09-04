import { describe, it, expect, beforeEach } from 'vitest';
import { asc } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import { normalizeTitle, titleSimilarity, clusterNewItems } from '@/lib/curate/cluster';
import { items, sources, stories } from '@/lib/db/schema';
import type { Db } from '@/lib/db';

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation and drops stopwords', () => {
    expect(normalizeTitle('The Quick-Brown FOX, and a dog!')).toEqual([
      'quick',
      'brown',
      'fox',
      'dog',
    ]);
  });

  it('returns empty for stopword-only titles', () => {
    expect(normalizeTitle('The And Of!')).toEqual([]);
  });
});

describe('titleSimilarity', () => {
  it('scores near-duplicate titles >= 0.55', () => {
    const s = titleSimilarity(
      'OpenAI launches GPT-5.2 with agentic tools',
      'GPT-5.2 launched by OpenAI: agentic tools',
    );
    expect(s).toBeGreaterThanOrEqual(0.55);
  });

  it('scores unrelated titles < 0.3', () => {
    const s = titleSimilarity(
      'OpenAI launches GPT-5.2 with agentic tools',
      'Midjourney v7 delivers photoreal image quality',
    );
    expect(s).toBeLessThan(0.3);
  });

  it('scores identical titles as 1', () => {
    expect(titleSimilarity('Claude Fable 5 released', 'Claude Fable 5 released')).toBe(1);
  });

  it('same product, same version, reworded: merges (E9)', () => {
    expect(titleSimilarity('Claude 4.5 pricing', 'Claude 4.5 launch')).toBeGreaterThanOrEqual(0.55);
  });

  it('short-title rule: two shared non-version tokens of ≤3 total merge (E9)', () => {
    // plain Jaccard here is 2/4 = 0.5 — the coarse 2-3-token grid could never
    // reach 0.55, so reworded same-news systematically missed the bar
    expect(titleSimilarity('Claude Code pricing', 'Claude Code launch')).toBeGreaterThanOrEqual(0.55);
  });

  it('different versions are DIFFERENT releases: shared version tokens do not bridge them (E9)', () => {
    expect(titleSimilarity('GPT-5', 'GPT-4')).toBeLessThan(0.55);
    // 3/5 plain Jaccard would have merged these; the version guard drops the shared '4'
    expect(titleSimilarity('Claude 4.5 pricing', 'Claude 4.6 pricing')).toBeLessThan(0.55);
  });

  it('unrelated products sharing only version tokens do not merge (E9)', () => {
    expect(titleSimilarity('Claude 4.5 pricing', 'Gemini 4.5 launch')).toBeLessThan(0.55);
  });

  it('scores empty/stopword-only titles as 0', () => {
    expect(titleSimilarity('', 'Claude Fable 5 released')).toBe(0);
    expect(titleSimilarity('the and', 'the and')).toBe(0);
  });
});

describe('clusterNewItems', () => {
  let db: Db;
  let sourceId: number;

  beforeEach(() => {
    db = useTestDb();
    sourceId = db
      .insert(sources)
      .values({ type: 'rss', name: 'Test Source' })
      .returning({ id: sources.id })
      .get().id;
  });

  function insertItem(title: string, url: string, publishedAt: Date | null = new Date()) {
    return db
      .insert(items)
      .values({ sourceId, url, title, fetchedAt: new Date(), publishedAt })
      .returning()
      .get();
  }

  it('merges two similar items into one story; a distinct third gets its own', async () => {
    const a = insertItem('OpenAI launches GPT-5.2 with agentic tools', 'https://a.example/1');
    const b = insertItem('GPT-5.2 launched by OpenAI: agentic tools', 'https://b.example/2');
    const c = insertItem('Midjourney v7 delivers photoreal image quality', 'https://c.example/3');

    const res = await clusterNewItems();
    expect(res).toEqual({ newStories: 2, merged: 1 });

    const allStories = db.select().from(stories).orderBy(asc(stories.id)).all();
    expect(allStories).toHaveLength(2);
    expect(allStories.every((s) => s.status === 'raw')).toBe(true);

    const rows = db.select().from(items).orderBy(asc(items.id)).all();
    const [rowA, rowB, rowC] = rows;
    expect(rowA.id).toBe(a.id);
    expect(rowB.id).toBe(b.id);
    expect(rowC.id).toBe(c.id);
    expect(rowA.storyId).not.toBeNull();
    expect(rowB.storyId).toBe(rowA.storyId);
    expect(rowC.storyId).not.toBeNull();
    expect(rowC.storyId).not.toBe(rowA.storyId);
  });

  it('attaches a similar item to an existing story created in the last 72h', async () => {
    const existing = db
      .insert(stories)
      .values({
        title: 'OpenAI launches GPT-5.2 with agentic tools',
        status: 'raw',
        createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      })
      .returning()
      .get();

    const item = insertItem('GPT-5.2 launched by OpenAI: agentic tools', 'https://d.example/1');

    const res = await clusterNewItems();
    expect(res).toEqual({ newStories: 0, merged: 1 });

    const row = db.select().from(items).all().find((r) => r.id === item.id)!;
    expect(row.storyId).toBe(existing.id);
  });

  it('does not attach to a similar story older than 72h', async () => {
    const old = db
      .insert(stories)
      .values({
        title: 'OpenAI launches GPT-5.2 with agentic tools',
        status: 'raw',
        createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000), // 100h ago
      })
      .returning()
      .get();

    const item = insertItem('GPT-5.2 launched by OpenAI: agentic tools', 'https://e.example/1');

    const res = await clusterNewItems();
    expect(res).toEqual({ newStories: 1, merged: 0 });

    const row = db.select().from(items).all().find((r) => r.id === item.id)!;
    expect(row.storyId).not.toBeNull();
    expect(row.storyId).not.toBe(old.id);
  });

  it('uses publishedAt (falling back to fetchedAt) as the new story createdAt', async () => {
    const published = new Date(Math.floor(Date.now() / 1000) * 1000 - 5 * 60 * 60 * 1000);
    insertItem('Anthropic ships computer-use upgrade', 'https://f.example/1', published);
    insertItem('Some totally unrelated benchmark drama', 'https://f.example/2', null);

    await clusterNewItems();

    const allStories = db.select().from(stories).orderBy(asc(stories.id)).all();
    expect(allStories).toHaveLength(2);
    expect(allStories[0].createdAt.getTime()).toBe(published.getTime());
    // second story fell back to fetchedAt (recent)
    expect(Date.now() - allStories[1].createdAt.getTime()).toBeLessThan(60_000);
  });
});

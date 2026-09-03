import { beforeEach, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { clusterNewItems } from '@/lib/curate/cluster';
import { items, sources, stories } from '@/lib/db/schema';
import type { Db } from '@/lib/db';
import { useTestDb } from './helpers/db';

/**
 * Parity test for the candidate-token precompute refactor: the exact
 * story assignments clusterNewItems produces on this seeded corpus must not
 * change when similarity scoring is restructured. Expectations below were
 * captured from the pre-refactor implementation.
 */
describe('clusterNewItems assignment parity', () => {
  let db: Db;
  let sourceId: number;

  beforeEach(() => {
    db = useTestDb();
    sourceId = db
      .insert(sources)
      .values({ type: 'rss', name: 'Parity Feed' })
      .returning({ id: sources.id })
      .get().id;
    // one pre-existing in-window story the first items should merge into
    db.insert(stories)
      .values({
        title: 'OpenAI launches GPT-5.2 with agentic tools',
        status: 'raw',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      })
      .run();
  });

  function insertItem(title: string, url: string) {
    db.insert(items).values({ sourceId, url, title, fetchedAt: new Date(), publishedAt: null }).run();
  }

  it('assigns the seeded corpus to exactly the same stories', async () => {
    const corpus: [string, string][] = [
      // near-dupes of the existing story → merge
      ['GPT-5.2 launched by OpenAI: agentic tools', 'https://p.example/1'],
      ['GPT-5.2 launched by OpenAI: agentic tools', 'https://p.example/2'],
      // new story A, then a reworded dupe that merges into it
      ['Midjourney v7 delivers photoreal image quality', 'https://p.example/3'],
      ['Midjourney v7: photoreal image quality delivers', 'https://p.example/4'],
      // new story B, then an exact-title dupe that merges into it
      ['Anthropic cuts Claude pricing by half', 'https://p.example/5'],
      ['Anthropic cuts Claude pricing by half', 'https://p.example/6'],
      // stopword-only titles: empty token sets never match anything, not even
      // each other — each becomes its own story
      ['the and of', 'https://p.example/7'],
      ['the and of', 'https://p.example/8'],
      // clearly distinct
      ['New pizza oven released', 'https://p.example/9'],
    ];
    for (const [title, url] of corpus) insertItem(title, url);

    const res = await clusterNewItems();
    expect(res).toEqual({ newStories: 5, merged: 4 });

    const rows = db.select().from(items).orderBy(asc(items.id)).all();
    const storyTitle = (storyId: number | null) =>
      storyId === null ? null : db.select().from(stories).all().find((s) => s.id === storyId)?.title;

    const assignments = rows.map((r) => ({ url: r.url, story: storyTitle(r.storyId) }));
    expect(assignments).toEqual([
      { url: 'https://p.example/1', story: 'OpenAI launches GPT-5.2 with agentic tools' },
      { url: 'https://p.example/2', story: 'OpenAI launches GPT-5.2 with agentic tools' },
      { url: 'https://p.example/3', story: 'Midjourney v7 delivers photoreal image quality' },
      { url: 'https://p.example/4', story: 'Midjourney v7 delivers photoreal image quality' },
      { url: 'https://p.example/5', story: 'Anthropic cuts Claude pricing by half' },
      { url: 'https://p.example/6', story: 'Anthropic cuts Claude pricing by half' },
      { url: 'https://p.example/7', story: 'the and of' },
      { url: 'https://p.example/8', story: 'the and of' },
      { url: 'https://p.example/9', story: 'New pizza oven released' },
    ]);
    // the two stopword-only items share a title but must live in DIFFERENT stories
    const stopword = rows.filter((r) => r.title === 'the and of');
    expect(stopword[0].storyId).not.toBe(stopword[1].storyId);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runPain } from '@/lib/pain';
import { items, llmCalls, sources } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('runPain empty discussion window', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
  });

  it('reports zero candidates and skips the LLM when only rss items exist', async () => {
    const source = db
      .insert(sources)
      .values({
        type: 'rss',
        name: 'example-blog',
        config: '{}',
      })
      .returning()
      .get()!;

    db.insert(items)
      .values({
        sourceId: source.id,
        url: 'https://example.com/fresh-rss',
        title: 'A recent RSS headline that is not a discussion thread',
        excerpt: 'Product news, not a Reddit or HN complaint.',
        fetchedAt: new Date(),
      })
      .run();

    const out = await runPain();

    expect(out.candidates).toBe(0);
    expect(out.pains).toBe(0);
    expect(out.comps).toBe(0);

    const painCalls = db.select().from(llmCalls).where(eq(llmCalls.feature, 'pain')).all();
    expect(painCalls).toHaveLength(0);
  });
});

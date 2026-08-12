import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import { stories } from '@/lib/db/schema';

vi.mock('@/lib/llm/minimax', () => ({
  chatJSON: vi.fn(),
  LlmError: class LlmError extends Error {},
}));
// eslint-disable-next-line import/first
import { chatJSON, LlmError } from '@/lib/llm/minimax';
// eslint-disable-next-line import/first
import { runSecondLook, sanitizeSecondLooks } from '@/lib/science/second-look';

function addStory(db: ReturnType<typeof useTestDb>, opts: Partial<{
  title: string;
  topScore: number;
  status: 'raw' | 'curated';
  hoursAgo: number;
  secondLook: string | null;
}> = {}) {
  return db
    .insert(stories)
    .values({
      title: opts.title ?? 'story',
      status: opts.status ?? 'curated',
      topScore: opts.topScore ?? 80,
      secondLook: opts.secondLook ?? null,
      createdAt: new Date(Date.now() - (opts.hoursAgo ?? 1) * 36e5),
    })
    .returning()
    .get();
}

describe('sanitizeSecondLooks', () => {
  const eligible = new Set([1, 2]);

  it('keeps valid rows, drops unknown ids and thin text', () => {
    const out = sanitizeSecondLooks(
      [
        { id: 1, second_look: 'This might not matter because the benchmark is cherry-picked.' },
        { id: 99, second_look: 'unknown story id — must be dropped entirely here.' },
        { id: 2, second_look: 'too short' },
        { id: 'x', second_look: 'bad id type — must be dropped as well, sorry.' },
        'garbage',
      ],
      eligible,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it('truncates over-long text to 500 chars', () => {
    const out = sanitizeSecondLooks([{ id: 1, second_look: 'x'.repeat(600) }], eligible);
    expect(out[0].second_look).toHaveLength(500);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeSecondLooks(undefined, eligible)).toEqual([]);
    expect(sanitizeSecondLooks({ results: [] }, eligible)).toEqual([]);
  });
});

describe('runSecondLook', () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => {
    db = useTestDb();
    vi.mocked(chatJSON).mockReset();
  });

  it('writes second looks only onto eligible top stories', async () => {
    const eligible = addStory(db, { topScore: 85 });
    addStory(db, { topScore: 50 }); // below the bar
    addStory(db, { topScore: 90, hoursAgo: 72 }); // out of the 48h window
    addStory(db, { topScore: 90, secondLook: 'already done — do not overwrite' });
    addStory(db, { topScore: 90, status: 'raw' });

    vi.mocked(chatJSON).mockResolvedValueOnce({
      results: [{ id: eligible.id, second_look: 'Adoption curves for this class of tool have flattened; the demo numbers come from a closed benchmark.' }],
    } as never);

    const stats = await runSecondLook();
    expect(stats).toEqual({ considered: 1, written: 1 });
    const updated = db.select().from(stories).where(eq(stories.id, eligible.id)).get();
    expect(updated?.secondLook).toContain('Adoption curves');
    expect(updated?.secondLookAt).not.toBeNull();
  });

  it('is a quiet no-op when the daily LLM cap is hit', async () => {
    addStory(db, { topScore: 85 });
    vi.mocked(chatJSON).mockRejectedValueOnce(new LlmError('cap', false) as never);
    const stats = await runSecondLook();
    expect(stats.written).toBe(0);
    expect(db.select().from(stories).all()[0].secondLook).toBeNull();
  });

  it('does nothing when no story qualifies — no LLM call', async () => {
    addStory(db, { topScore: 40 });
    const stats = await runSecondLook();
    expect(stats).toEqual({ considered: 0, written: 0 });
    expect(vi.mocked(chatJSON)).not.toHaveBeenCalled();
  });
});

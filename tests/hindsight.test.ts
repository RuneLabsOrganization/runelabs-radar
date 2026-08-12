import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { getDb } from '@/lib/db';
import { launches, stories, users, votes } from '@/lib/db/schema';
import { hindsightScore, runRescore } from '@/lib/science/hindsight';

function addStory(opts: {
  title: string;
  createdAt: Date;
  entities?: { name: string; kind: string }[];
  topScore?: number;
}): number {
  return getDb()
    .insert(stories)
    .values({
      title: opts.title,
      status: 'curated',
      topScore: opts.topScore ?? 50,
      createdAt: opts.createdAt,
      entities: opts.entities ? JSON.stringify(opts.entities) : null,
    })
    .returning({ id: stories.id })
    .get().id;
}

describe('hindsightScore', () => {
  beforeEach(() => useTestDb());

  it('scores echoes + launch + follow-through + votes', () => {
    const now = Date.now();
    const base = new Date(now - 48 * 36e5);
    const id = addStory({
      title: 'Acme launches Testify model',
      createdAt: base,
      entities: [{ name: 'Testify', kind: 'model' }],
    });
    // 5 echo stories mentioning the entity
    for (let i = 0; i < 5; i++) {
      addStory({
        title: `Testify benchmark analysis part ${i}`,
        createdAt: new Date(base.getTime() + (i + 1) * 36e5),
        entities: [{ name: 'Testify', kind: 'model' }],
      });
    }
    // launch materializes
    getDb()
      .insert(launches)
      .values({
        source: 'show-hn',
        title: 'Show HN: Testify playground',
        url: 'https://example.com/testify',
        launchedAt: new Date(base.getTime() + 10 * 36e5),
        createdAt: new Date(),
      })
      .run();
    // one upvote
    getDb().insert(users).values({ name: 'u', passwordHash: 'x', role: 'member' }).run();
    getDb().insert(votes).values({ userId: 1, storyId: id, value: 1 }).run();

    const s = getDb().select().from(stories).all().find((r) => r.id === id)!;
    const score = hindsightScore(s);
    // echo 30 + launch 25 + follow ~5 titles are similar-ish + vote 5 → >55
    expect(score).toBeGreaterThan(55);
  });

  it('a story nobody followed up on scores ~0', () => {
    const now = Date.now();
    const id = addStory({
      title: 'Obscure changelog bump',
      createdAt: new Date(now - 48 * 36e5),
      entities: [{ name: 'Nothingburger', kind: 'tool' }],
    });
    addStory({ title: 'Completely unrelated news', createdAt: new Date(now - 24 * 36e5) });
    const s = getDb().select().from(stories).all().find((r) => r.id === id)!;
    expect(hindsightScore(s)).toBeLessThanOrEqual(10);
  });
});

describe('runRescore', () => {
  beforeEach(() => useTestDb());

  it('scores only stories inside the 36-60h window, once', async () => {
    const now = Date.now();
    addStory({ title: 'in window', createdAt: new Date(now - 48 * 36e5) });
    addStory({ title: 'too fresh', createdAt: new Date(now - 12 * 36e5) });
    addStory({ title: 'too old', createdAt: new Date(now - 72 * 36e5) });

    const first = await runRescore();
    expect(first.scored).toBe(1);
    const second = await runRescore();
    expect(second.scored).toBe(0); // idempotent

    const rows = getDb().select().from(stories).all();
    expect(rows.find((r) => r.title === 'in window')!.hindsight).not.toBeNull();
    expect(rows.find((r) => r.title === 'too fresh')!.hindsight).toBeNull();
    expect(rows.find((r) => r.title === 'too old')!.hindsight).toBeNull();
  });
});

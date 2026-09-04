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

  it('an echo story is never ALSO follow-through (no double-counting)', () => {
    const base = new Date(Date.now() - 48 * 36e5);
    const id = addStory({
      title: 'Zqxwv model gains vision',
      createdAt: base,
      entities: [{ name: 'Zqxwv', kind: 'model' }],
    });
    // shares the entity AND is title-similar enough (Jaccard 0.5) to score
    // follow-through — the old code paid it into both buckets
    addStory({
      title: 'Zqxwv model gains new tricks',
      createdAt: new Date(base.getTime() + 36e5),
      entities: [{ name: 'Zqxwv', kind: 'model' }],
    });
    const s = getDb().select().from(stories).all().find((r) => r.id === id)!;
    // echo only: w = 1/log(2+1), cap = 5 × 48h/120h = 2 → (1/log 3)/2 × 30 ≈ 14
    expect(hindsightScore(s)).toBe(Math.round((1 / Math.log(3) / 2) * 30));
  });

  it('a rare entity outweighs a popular one at equal echo counts (idf discount)', () => {
    const base = new Date(Date.now() - 48 * 36e5);
    // "openai" was already everywhere in the days before the story
    for (let i = 0; i < 8; i++) {
      addStory({
        title: `Prior vendor roundup volume ${i}`,
        createdAt: new Date(base.getTime() - (i + 1) * 12 * 36e5),
        entities: [{ name: 'openai', kind: 'company' }],
      });
    }
    const rare = addStory({
      title: 'Quietlibrary ships deterministic builds',
      createdAt: base,
      entities: [{ name: 'quietlibrary', kind: 'tool' }],
    });
    const common = addStory({
      title: 'Vendor expands enterprise tier',
      createdAt: base,
      entities: [{ name: 'openai', kind: 'company' }],
    });
    // two echoes each, same timing
    for (let i = 0; i < 2; i++) {
      addStory({
        title: `Quietlibrary benchmark deep-dive ${i}`,
        createdAt: new Date(base.getTime() + (i + 1) * 36e5),
        entities: [{ name: 'quietlibrary', kind: 'tool' }],
      });
      addStory({
        title: `Enterprise pricing reaction piece ${i}`,
        createdAt: new Date(base.getTime() + (i + 1) * 36e5),
        entities: [{ name: 'openai', kind: 'company' }],
      });
    }
    const rows = getDb().select().from(stories).all();
    const rareScore = hindsightScore(rows.find((r) => r.id === rare)!);
    const commonScore = hindsightScore(rows.find((r) => r.id === common)!);
    // old code: identical (2 echoes each, 2/2 → capped 30). With the idf
    // discount the popular entity's echoes are worth 1/log(2+10) each.
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it('caps scale with the elapsed window — a 2-day-old story is not judged against 5 days', () => {
    const fresh = new Date(Date.now() - 48 * 36e5);
    const old = new Date(Date.now() - 120 * 36e5);
    const young = addStory({
      title: 'Alphatool runtime goes open',
      createdAt: fresh,
      entities: [{ name: 'alphatool', kind: 'tool' }],
    });
    const aged = addStory({
      title: 'Betatool runtime goes open',
      createdAt: old,
      entities: [{ name: 'betatool', kind: 'tool' }],
    });
    // identical follow-through: two rare-entity echoes right after each story
    for (let i = 0; i < 2; i++) {
      addStory({
        title: `Alphatool internals walkthrough ${i}`,
        createdAt: new Date(fresh.getTime() + (i + 1) * 36e5),
        entities: [{ name: 'alphatool', kind: 'tool' }],
      });
      addStory({
        title: `Betatool internals walkthrough ${i}`,
        createdAt: new Date(old.getTime() + (i + 1) * 36e5),
        entities: [{ name: 'betatool', kind: 'tool' }],
      });
    }
    const rows = getDb().select().from(stories).all();
    const youngScore = hindsightScore(rows.find((r) => r.id === young)!);
    const agedScore = hindsightScore(rows.find((r) => r.id === aged)!);
    // old code: both = (2/5)×30 = 12 — the 2-day-old story was silently graded
    // against three days of follow-through it never had the chance to earn
    expect(youngScore).toBeGreaterThan(agedScore);
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
    expect(first.backlog).toBe(0);
    const second = await runRescore();
    expect(second.scored).toBe(0); // idempotent

    const rows = getDb().select().from(stories).all();
    expect(rows.find((r) => r.title === 'in window')!.hindsight).not.toBeNull();
    expect(rows.find((r) => r.title === 'too fresh')!.hindsight).toBeNull();
    expect(rows.find((r) => r.title === 'too old')!.hindsight).toBeNull();
  });

  it('overflow beyond the daily cap becomes backlog and is processed oldest-first next run', async () => {
    const now = Date.now();
    // 1 story near the window's far edge + 120 fresh-in-window stories = 121 due
    addStory({ title: 'oldest in window', createdAt: new Date(now - 59.5 * 36e5) });
    for (let i = 0; i < 120; i++) {
      addStory({ title: `bulk story ${i}`, createdAt: new Date(now - 40 * 36e5) });
    }

    const first = await runRescore();
    expect(first.scored).toBe(120);
    expect(first.backlog).toBe(1);

    // OLDEST first: the story about to age out is the one that got scored;
    // the old newest-first order dropped exactly that story past 60h forever
    const rows = getDb().select().from(stories).all();
    expect(rows.find((r) => r.title === 'oldest in window')!.hindsight).not.toBeNull();
    expect(rows.filter((r) => r.hindsight === null)).toHaveLength(1);

    // the overflow is still inside the window → picked up next run
    const second = await runRescore();
    expect(second.scored).toBe(1);
    expect(second.backlog).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { boardHistory, stories } from '@/lib/db/schema';
import { freshnessStats } from '@/lib/freshness';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const NOW = new Date('2026-08-20T00:00:00Z');
const H = 3_600_000;

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function addStory(title: string, entity: string, createdAt: Date) {
  db.insert(stories)
    .values({
      title,
      status: 'curated',
      topScore: 80,
      entities: JSON.stringify([{ name: entity, kind: 'model' }]),
      createdAt,
    })
    .run();
}

function addChange(change: string, appliedAt: Date) {
  db.insert(boardHistory).values({ domain: 'coding', task: 'codegen', change, appliedAt }).run();
}

describe('freshnessStats — board_history read is window-bounded (I4)', () => {
  it('behavior is preserved on seeded history: first matching change at/after the story wins', () => {
    const createdAt = new Date(NOW.getTime() - 10 * H);
    addStory('WindowModel launches', 'WindowModel', createdAt);
    addChange('bestOverall: x -> WindowModel', new Date(createdAt.getTime() + 4 * H));
    addChange('bestValue: y -> WindowModel', new Date(createdAt.getTime() + 9 * H));

    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(1);
    expect(boardReflection.medianHours).toBe(4);
  });

  it('rows outside the window do not affect results', () => {
    const createdAt = new Date(NOW.getTime() - 10 * H);
    addStory('OldMention launches', 'OldMention', createdAt);
    // a row far outside the 90-day window mentioning the same entity
    addChange('bestOverall: x -> OldMention', new Date(NOW.getTime() - 200 * 24 * H));
    // the real reflection, inside the window
    addChange('bestOverall: y -> OldMention', new Date(createdAt.getTime() + 6 * H));

    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(1);
    expect(boardReflection.pairs[0].lagHours).toBe(6);
    expect(boardReflection.medianHours).toBe(6);
  });

  it('a change applied exactly at the window edge stays eligible', () => {
    const since = new Date(NOW.getTime() - 90 * 24 * H);
    addStory('EdgeModel launches', 'EdgeModel', since);
    addChange('bestOverall: x -> EdgeModel', new Date(since.getTime() + 2 * H));

    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(1);
    expect(boardReflection.medianHours).toBe(2);
  });

  it('with only out-of-window rows present, nothing matches', () => {
    const createdAt = new Date(NOW.getTime() - 10 * H);
    addStory('GhostModel launches', 'GhostModel', createdAt);
    addChange('bestOverall: x -> GhostModel', new Date(NOW.getTime() - 365 * 24 * H));

    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(0);
    expect(boardReflection.medianHours).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { stories } from '@/lib/db/schema';
import { topEntitiesInDomain } from '@/lib/entity-extras';
import { useTestDb } from './helpers/db';

describe('topEntitiesInDomain', () => {
  beforeEach(() => {
    useTestDb();
  });

  function put(
    db: ReturnType<typeof useTestDb>,
    title: string,
    scores: Record<string, number>,
    entities: { name: string; kind: string }[],
  ) {
    db.insert(stories)
      .values({
        title,
        status: 'curated',
        topScore: 70,
        domainScores: JSON.stringify(scores),
        entities: JSON.stringify(entities),
        createdAt: new Date(),
      })
      .run();
  }

  it('ranks entities from stories clearing the domain threshold, canonical-merged', () => {
    const db = useTestDb();
    put(db, 'a', { coding: 80 }, [{ name: 'GPT-5', kind: 'model' }]);
    put(db, 'b', { coding: 60 }, [{ name: 'gpt 5', kind: 'model' }, { name: 'Cursor', kind: 'tool' }]);
    put(db, 'c', { coding: 30 }, [{ name: 'BelowThreshold', kind: 'tool' }]);
    put(db, 'd', { coding: 70 }, [{ name: 'Cursor', kind: 'tool' }]);
    const out = topEntitiesInDomain('coding');
    // GPT-5 merged across 2 stories, Cursor in 2, sub-threshold story excluded
    expect(out[0].count).toBe(2);
    expect(out.map((e) => e.name)).toContain('Cursor');
    expect(out.map((e) => e.name)).not.toContain('BelowThreshold');
    expect(out.filter((e) => e.name.toLowerCase().includes('gpt'))).toHaveLength(1);
  });

  it('returns [] when no story clears the threshold', () => {
    const db = useTestDb();
    put(db, 'a', { coding: 20 }, [{ name: 'GPT-5', kind: 'model' }]);
    expect(topEntitiesInDomain('coding')).toEqual([]);
  });
});

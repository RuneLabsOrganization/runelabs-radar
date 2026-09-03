import { beforeEach, describe, expect, it } from 'vitest';
import { stories } from '@/lib/db/schema';
import { resolveEntity } from '@/lib/entity';
import { coMentioned } from '@/lib/entity-extras';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const DAY = 864e5;

function addStory(db: Db, title: string, entities: { name: string; kind: string }[], daysAgo: number) {
  db.insert(stories)
    .values({
      title,
      status: 'curated',
      topScore: 70,
      entities: JSON.stringify(entities),
      // timestamp mode stores unix seconds — the window math must match that unit
      createdAt: new Date(Date.now() - daysAgo * DAY),
    })
    .run();
}

describe('entity 90d read window', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('resolveEntity returns null when every mention is older than the window (91d)', () => {
    addStory(db, 'ancient news', [{ name: 'OldEraModel', kind: 'model' }], 91);
    expect(resolveEntity('olderamodel')).toBeNull();
  });

  it('resolveEntity finds an entity mentioned inside the window (89d)', () => {
    addStory(db, 'recent news', [{ name: 'NewEraModel', kind: 'model' }], 89);
    const entity = resolveEntity('neweramodel');
    expect(entity).not.toBeNull();
    expect(entity!.kind).toBe('model');
    expect(entity!.mentions).toBe(1);
  });

  it('counts only in-window mentions when an entity spans both eras', () => {
    addStory(db, 'old mention', [{ name: 'DualEraModel', kind: 'model' }], 120);
    addStory(db, 'older mention', [{ name: 'DualEraModel', kind: 'model' }], 95);
    addStory(db, 'fresh mention', [{ name: 'DualEraModel', kind: 'model' }], 10);
    const entity = resolveEntity('dualeramodel');
    expect(entity).not.toBeNull();
    expect(entity!.mentions).toBe(1);
  });

  it('ignores non-curated stories inside the window', () => {
    db.insert(stories)
      .values({
        title: 'raw mention',
        status: 'raw',
        topScore: 70,
        entities: JSON.stringify([{ name: 'RawOnlyModel', kind: 'model' }]),
        createdAt: new Date(),
      })
      .run();
    expect(resolveEntity('rawonlymodel')).toBeNull();
  });

  it('coMentioned is bounded by the same window', () => {
    addStory(
      db,
      'fresh pair',
      [
        { name: 'CoWindowAlpha', kind: 'model' },
        { name: 'CoWindowBeta', kind: 'tool' },
      ],
      5,
    );
    addStory(
      db,
      'ancient pair',
      [
        { name: 'CoWindowAlpha', kind: 'model' },
        { name: 'CoWindowGamma', kind: 'tool' },
      ],
      91,
    );

    const names = coMentioned('CoWindowAlpha').map((c) => c.name);
    expect(names).toContain('CoWindowBeta');
    expect(names).not.toContain('CoWindowGamma');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { stories } from '@/lib/db/schema';
import { topEntities } from '@/lib/analytics';
import {
  canonicalEntityKey,
  canonicalEntityName,
  entitySlug,
  resolveEntity,
  topEntitySlugs,
  ENTITY_ALIASES,
} from '@/lib/entity';
import { useTestDb } from './helpers/db';

describe('canonicalEntityKey', () => {
  it('folds case, spaces and punctuation', () => {
    expect(canonicalEntityKey('GPT-5')).toBe('gpt5');
    expect(canonicalEntityKey('gpt 5')).toBe('gpt5');
    expect(canonicalEntityKey('GPT5')).toBe('gpt5');
    expect(canonicalEntityKey('Claude Sonnet 4.5')).toBe('claudesonnet45');
    expect(canonicalEntityKey('ComfyUI')).toBe('comfyui');
  });
});

describe('canonicalEntityName', () => {
  it('tidies whitespace and applies the alias map', () => {
    expect(canonicalEntityName('  GPT   5 ')).toBe('GPT 5');
    // aliases map the variant's canonical key → preferred display name
    expect(canonicalEntityName('OpenAI o3')).toBe('o3');
    expect(canonicalEntityName('openai o4-mini')).toBe('o4-mini');
  });
});

describe('entity storage canonicalization', () => {
  let db: ReturnType<typeof useTestDb>;
  beforeEach(() => {
    db = useTestDb();
  });

  function addStory(title: string, entities: { name: string; kind: string }[], hoursAgo = 1) {
    db.insert(stories)
      .values({
        title,
        status: 'curated',
        topScore: 70,
        entities: JSON.stringify(entities),
        createdAt: new Date(Date.now() - hoursAgo * 36e5),
      })
      .run();
  }

  it('topEntities merges name variants into one entry', () => {
    addStory('a', [{ name: 'GPT-5', kind: 'model' }]);
    addStory('b', [{ name: 'gpt 5', kind: 'model' }]);
    addStory('c', [{ name: 'ComfyUI', kind: 'tool' }]);
    const top = topEntities(10);
    const gpt = top.filter((e) => canonicalEntityKey(e.name) === 'gpt5');
    expect(gpt).toHaveLength(1);
    expect(gpt[0].count).toBe(2);
  });

  it('topEntities counts each entity once per story even with two variants', () => {
    addStory('a', [
      { name: 'GPT-5', kind: 'model' },
      { name: 'GPT 5', kind: 'model' },
    ]);
    const top = topEntities(10);
    expect(top.find((e) => canonicalEntityKey(e.name) === 'gpt5')?.count).toBe(1);
  });

  it('resolveEntity finds an entity from any variant slug and sums mentions', () => {
    addStory('a', [{ name: 'GPT-5', kind: 'model' }]);
    addStory('b', [{ name: 'gpt 5', kind: 'model' }]);
    const entity = resolveEntity('gpt-5');
    expect(entity).not.toBeNull();
    expect(entity!.mentions).toBe(2);
    expect(entity!.kind).toBe('model');
    expect(resolveEntity('no-such-thing')).toBeNull();
  });

  it('topEntitySlugs emits one slug per canonical entity', () => {
    addStory('a', [{ name: 'GPT-5', kind: 'model' }]);
    addStory('b', [{ name: 'gpt 5', kind: 'model' }]);
    const slugs = topEntitySlugs(50);
    expect(slugs.filter((s) => s === entitySlug('GPT-5'))).toHaveLength(1);
  });
});

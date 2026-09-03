import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { stories } from '@/lib/db/schema';
import { enrichEvidence } from '@/lib/opportunities/evidence';
import { useTestDb } from './helpers/db';

function addStory(title: string, createdAt: Date): number {
  return getDb()
    .insert(stories)
    .values({ title, status: 'curated', topScore: 70, createdAt })
    .returning({ id: stories.id })
    .get()!.id;
}

describe('enrichEvidence story-prefix LIKE escaping', () => {
  beforeEach(() => useTestDb());

  it('matches a literal % in the label instead of treating it as a wildcard', () => {
    const literal = addStory('100% Coverage Hits General Availability', new Date(Date.now() - 864e5));
    addStory('1000 Coverage Hits General Availability', new Date()); // newer — wins an unescaped match

    const [item] = enrichEvidence([{ type: 'story', label: '100% Coverage Hits General Availability' }]);

    expect(item!.href).toBe(`/story/${literal}`);
  });

  it('matches a literal _ in the label', () => {
    const literal = addStory('kit_review tool ships today', new Date(Date.now() - 864e5));
    addStory('kitXreview tool ships today', new Date()); // '_' as wildcard would match the 'X'

    const [item] = enrichEvidence([{ type: 'story', label: 'kit_review tool ships today' }]);

    expect(item!.href).toBe(`/story/${literal}`);
  });

  it('still prefix-matches ordinary ellipsized labels', () => {
    const id = addStory('Bulk image tools are having a moment again', new Date());

    const [item] = enrichEvidence([{ type: 'story', label: 'Bulk image tools are having a mom…' }]);

    expect(item!.href).toBe(`/story/${id}`);
  });
});

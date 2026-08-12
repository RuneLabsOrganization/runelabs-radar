import { beforeEach, describe, expect, it } from 'vitest';
import { stories } from '@/lib/db/schema';
import {
  enrichEvidence,
  entityEvidenceHref,
  entityNameFromLabel,
} from '@/lib/opportunities/evidence';
import { useTestDb } from './helpers/db';

describe('entityNameFromLabel', () => {
  it('strips the mentions suffix', () => {
    expect(entityNameFromLabel('MiniMax H3 (6 mentions)')).toBe('MiniMax H3');
    expect(entityNameFromLabel('ComfyUI (1 mention)')).toBe('ComfyUI');
  });

  it('passes plain labels through', () => {
    expect(entityNameFromLabel('OpenAI')).toBe('OpenAI');
    expect(entityNameFromLabel('  ')).toBeNull();
  });
});

describe('entityEvidenceHref', () => {
  it('builds watch-page hrefs', () => {
    expect(entityEvidenceHref('MiniMax H3 (6 mentions)')).toBe('/entity/minimax-h3');
    expect(entityEvidenceHref('ComfyUI')).toBe('/entity/comfyui');
  });
});

describe('enrichEvidence', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('links story evidence to the latest curated title-prefix match', () => {
    const db = useTestDb();
    db.insert(stories)
      .values({ title: 'OpenAI launches GPT-5.6', status: 'curated', topScore: 80, createdAt: new Date() })
      .run();
    db.insert(stories)
      .values({ title: 'OpenAI launches something else entirely', status: 'curated', topScore: 70, createdAt: new Date(Date.now() - 864e5) })
      .run();
    const [story] = enrichEvidence([{ type: 'story', label: 'OpenAI launches GPT-5.6…' }]);
    expect(story.href).toMatch(/^\/story\/\d+$/);
  });

  it('returns null href for unknown stories and non-linkable types', () => {
    const [story, pain, pattern] = enrichEvidence([
      { type: 'story', label: 'No such story exists anywhere' },
      { type: 'pain', label: 'VRAM limits' },
      { type: 'pattern', label: 'sector spike' },
    ]);
    expect(story.href).toBeNull();
    expect(pain.href).toBeNull();
    expect(pattern.href).toBeNull();
  });

  it('links entity evidence', () => {
    const [e] = enrichEvidence([{ type: 'entity', label: 'OpenAI (12 mentions)' }]);
    expect(e.href).toBe('/entity/openai');
  });
});

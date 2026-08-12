import { beforeEach, describe, expect, it } from 'vitest';
import { stories } from '@/lib/db/schema';
import { allEntityNames, matchEntity, stackMarkdown } from '@/lib/stacks/match';
import { useTestDb } from './helpers/db';

function entitiesMap(entries: [string, string][]): Map<string, string> {
  return new Map(entries);
}

describe('matchEntity', () => {
  const entities = entitiesMap([
    ['kimik3', 'Kimi K3'],
    ['comfyui', 'ComfyUI'],
    ['gpt5', 'GPT-5'],
    ['sora', 'Sora'],
  ]);

  it('matches exact canonical keys', () => {
    expect(matchEntity('Kimi K3', entities)?.slug).toBe('kimi-k3');
    expect(matchEntity('gpt-5', entities)?.name).toBe('GPT-5');
  });

  it('matches containment inside pick decorations', () => {
    expect(matchEntity('Kimi K3 (xhigh)', entities)?.name).toBe('Kimi K3');
    expect(matchEntity('ComfyUI via Replicate', entities)?.slug).toBe('comfyui');
  });

  it('prefers the longest containment match and ignores short/generic names', () => {
    const withShort = entitiesMap([
      ['gpt', 'GPT'],
      ['gpt5', 'GPT-5'],
      ['ai', 'AI'],
    ]);
    expect(matchEntity('GPT-5 (max)', withShort)?.name).toBe('GPT-5');
    expect(matchEntity('ai chips', withShort)).toBeNull(); // 2-char keys never match
  });

  it('returns null on a miss', () => {
    expect(matchEntity('PostgreSQL 17', entities)).toBeNull();
  });
});

describe('allEntityNames', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('collects distinct canonical-keyed entity names from curated stories', () => {
    const db = useTestDb();
    const put = (title: string, entities: { name: string; kind: string }[]) =>
      db.insert(stories).values({ title, status: 'curated', topScore: 60, entities: JSON.stringify(entities), createdAt: new Date() }).run();
    put('a', [{ name: 'GPT-5', kind: 'model' }]);
    put('b', [{ name: 'gpt 5', kind: 'model' }, { name: 'OpenAI', kind: 'org' }]);
    const names = allEntityNames();
    expect(names.get('gpt5')).toBeDefined();
    expect(names.get('openai')).toBe('OpenAI');
    expect(names.size).toBe(2); // GPT-5 and "gpt 5" merged
  });
});

describe('stackMarkdown', () => {
  it('builds the full clipboard payload with attribution', () => {
    const md = stackMarkdown(
      'B2B SaaS MVP Stack',
      {
        title: 'B2B SaaS MVP Stack',
        tagline: 'Fast t2m, boring ops',
        timeToMvp: '1-2 weeks',
        costNote: '~$50/mo',
        rationale: 'Speed over novelty.',
      },
      [
        { layer: 'framework', pick: 'Next.js', alt: 'Remix', note: 'app router' },
        { layer: 'llm', pick: 'MiniMax M2', alt: null, note: null },
      ],
    );
    expect(md).toContain('# B2B SaaS MVP Stack');
    expect(md).toContain('time to mvp: 1-2 weeks · run cost: ~$50/mo');
    expect(md).toContain('- **framework**: Next.js (alt: Remix) — app router');
    expect(md).toContain('- **llm**: MiniMax M2');
    expect(md).toContain('Speed over novelty.');
    expect(md).toMatch(/via .+ · http/);
  });
});

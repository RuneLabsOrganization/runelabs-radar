import { beforeEach, describe, expect, it } from 'vitest';
import { deriveTags, loadPrimitives } from '@/lib/opportunities/primitives';
import { painPoints } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('deriveTags', () => {
  it('tags agentic language', () => {
    expect(deriveTags('teams cannot get their MCP agent to call tools reliably', null))
      .toContain('agentic');
  });

  it('tags regulated language', () => {
    expect(deriveTags('SOC2 compliance evidence collection is manual', null)).toContain('regulated');
  });

  it('tags from the sector when the text is quiet', () => {
    expect(deriveTags('nothing specific here at all', 'devtools')).toContain('devtools');
  });

  it('de-duplicates repeated keyword hits', () => {
    expect(deriveTags('API api Api infrastructure', null).filter((t) => t === 'infra')).toHaveLength(1);
  });

  it('always returns at least one tag', () => {
    expect(deriveTags('', null).length).toBeGreaterThan(0);
  });
});

describe('loadPrimitives', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('returns an empty list when the stream is empty', () => {
    expect(loadPrimitives()).toEqual([]);
  });

  it('extracts pains with normalized intensity and refs', () => {
    const now = new Date();
    db.insert(painPoints)
      .values({
        summary: 'Bulk background removal for product photos is painfully manual',
        sector: 'commerce',
        intensity: 9,
        createdAt: now,
        lastSeenAt: now,
      })
      .run();

    const prims = loadPrimitives();
    expect(prims).toHaveLength(1);
    expect(prims[0].type).toBe('pain');
    expect(prims[0].ref).toMatch(/^P\d+$/);
    expect(prims[0].intensity).toBeGreaterThan(0);
    expect(prims[0].intensity).toBeLessThanOrEqual(100);
    expect(prims[0].tags).toContain('commerce');
  });

  it('gives every primitive a unique ref', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      db.insert(painPoints)
        .values({
          summary: `A distinct recurring pain number ${i} that teams keep reporting`,
          sector: 'devtools',
          intensity: 5,
          createdAt: now,
          lastSeenAt: now,
        })
        .run();
    }
    const refs = loadPrimitives().map((p) => p.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

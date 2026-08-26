import { beforeEach, describe, expect, it } from 'vitest';
import { deriveTags, loadPrimitives } from '@/lib/opportunities/primitives';
import { painPoints, stories } from '@/lib/db/schema';
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

  it('keeps demand-bearing primitives a majority against a flood of tagged stories', () => {
    seedPains(db, 10);
    seedTaggedStories(db, 30);
    const prims = loadPrimitives();
    const pains = prims.filter((p) => p.type === 'pain');
    const storyPrims = prims.filter((p) => p.type === 'story');
    expect(storyPrims).toHaveLength(5);
    expect(pains.length).toBeGreaterThan(storyPrims.length);
  });

  it('returns nothing when there is no demand signal, even if stories exist', () => {
    seedTaggedStories(db, 30);
    expect(loadPrimitives()).toEqual([]);
  });

  it('admits floor(pains/2) stories when there are no patterns', () => {
    seedPains(db, 2);
    seedTaggedStories(db, 10);
    const prims = loadPrimitives();
    expect(prims.filter((p) => p.type === 'story')).toHaveLength(1);
    expect(prims.filter((p) => p.type === 'pain')).toHaveLength(2);
  });

  it('never admits a story whose only tag is general, even when budget remains', () => {
    seedPains(db, 2);
    const title = 'The sun shone on the hills';
    seedStory(db, title, 99);
    const prims = loadPrimitives();
    expect(deriveTags(title, null)).toEqual(['general']);
    expect(prims.filter((p) => p.type === 'story')).toHaveLength(0);
    expect(prims.filter((p) => p.type === 'pain')).toHaveLength(2);
  });

  it('fills context slots with the highest-intensity stories', () => {
    seedPains(db, 10);
    const scores = [15, 90, 40, 75, 20, 60, 55, 80];
    for (const score of scores) {
      seedStory(db, `MCP agent code review tools scoring ${score}`, score);
    }
    const admitted = loadPrimitives()
      .filter((p) => p.type === 'story')
      .map((p) => p.label);
    expect(admitted).toHaveLength(5);
    expect(admitted).toEqual([
      'MCP agent code review tools scoring 90',
      'MCP agent code review tools scoring 80',
      'MCP agent code review tools scoring 75',
      'MCP agent code review tools scoring 60',
      'MCP agent code review tools scoring 55',
    ]);
  });

  it('keeps refs unique and typed within P/A/E/S', () => {
    seedPains(db, 4);
    seedTaggedStories(db, 8);
    const refs = loadPrimitives().map((p) => p.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) {
      expect(ref).toMatch(/^[PAES]\d+$/);
    }
  });

  it('rescales pains that all share intensity 1 to 50, not 5', () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      db.insert(painPoints)
        .values({
          summary: `A distinct recurring pain number ${i} that teams keep reporting`,
          sector: 'devtools',
          intensity: 1,
          createdAt: now,
          lastSeenAt: now,
        })
        .run();
    }
    const pains = loadPrimitives().filter((p) => p.type === 'pain');
    expect(pains).toHaveLength(3);
    expect(pains.every((p) => p.intensity === 50)).toBe(true);
    expect(pains.some((p) => p.intensity === 5)).toBe(false);
  });

  it('maps the weakest pain to 0 and the strongest to 100 when raw intensity is 1..5', () => {
    const now = new Date();
    for (let i = 1; i <= 5; i++) {
      db.insert(painPoints)
        .values({
          summary: `A distinct recurring pain number ${i} that teams keep reporting`,
          sector: 'devtools',
          intensity: i,
          createdAt: now,
          lastSeenAt: now,
        })
        .run();
    }
    const intensities = loadPrimitives()
      .filter((p) => p.type === 'pain')
      .map((p) => p.intensity)
      .sort((a, b) => a - b);
    expect(intensities[0]).toBe(0);
    expect(intensities[intensities.length - 1]).toBe(100);
  });

  it('rescales stories against stories only, never against pains', () => {
    const now = new Date();
    for (let i = 0; i < 4; i++) {
      db.insert(painPoints)
        .values({
          summary: `A distinct recurring pain number ${i} that teams keep reporting`,
          sector: 'devtools',
          intensity: 1,
          createdAt: now,
          lastSeenAt: now,
        })
        .run();
    }
    seedStory(db, 'MCP agent code review tools scoring 90', 90);
    seedStory(db, 'MCP agent code review tools scoring 80', 80);
    const prims = loadPrimitives();
    const storyIntensities = prims
      .filter((p) => p.type === 'story')
      .map((p) => p.intensity)
      .sort((a, b) => a - b);
    expect(storyIntensities).toEqual([0, 100]);
    expect(prims.filter((p) => p.type === 'pain').every((p) => p.intensity === 50)).toBe(true);
  });
});

function seedPains(db: Db, n: number) {
  const now = new Date();
  for (let i = 0; i < n; i++) {
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
}

function seedStory(db: Db, title: string, topScore: number) {
  db.insert(stories)
    .values({
      title,
      tldr: null,
      status: 'curated',
      topScore,
      createdAt: new Date(),
    })
    .run();
}

function seedTaggedStories(db: Db, n: number) {
  for (let i = 0; i < n; i++) {
    seedStory(db, `MCP agent code review backlog variant ${i}`, 50 + i);
  }
}

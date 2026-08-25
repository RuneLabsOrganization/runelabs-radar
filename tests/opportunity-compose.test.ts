import { beforeEach, describe, expect, it } from 'vitest';
import { composeLeads } from '@/lib/opportunities/compose';
import { loadWedges, seedWedges, wedgeCompatible, wedgeAt } from '@/lib/opportunities/wedges';
import type { Primitive } from '@/lib/opportunities/primitives';
import { useTestDb } from './helpers/db';

function prim(ref: string, label: string, tags: string[], intensity = 50): Primitive {
  return { ref, type: 'pain', label, sector: null, tags, intensity };
}

const PRIMITIVES: Primitive[] = [
  prim('P1', 'Bulk product photo editing is manual for storefront sellers', ['commerce', 'creative']),
  prim('P2', 'Agents cannot call internal tools without bespoke glue', ['agentic', 'infra']),
  prim('P3', 'SOC2 evidence collection eats a week each quarter', ['regulated', 'data']),
  prim('P4', 'Code review backlogs block small teams', ['devtools']),
];

describe('composeLeads', () => {
  beforeEach(() => {
    useTestDb();
    seedWedges();
  });

  it('returns the requested number of leads', () => {
    const res = composeLeads({
      primitives: PRIMITIVES, space: loadWedges(),
      ownerKey: 'user:1', day: '2026-08-25', cursor: 0, limit: 5,
    });
    expect(res.leads).toHaveLength(5);
  });

  it('only emits compatible pairings', () => {
    const space = loadWedges();
    const res = composeLeads({
      primitives: PRIMITIVES, space,
      ownerKey: 'user:1', day: '2026-08-25', cursor: 0, limit: 20,
    });
    for (const lead of res.leads) {
      const primitive = PRIMITIVES.find((p) => lead.primitiveRefs.includes(p.ref));
      expect(primitive, `lead ${lead.slug} has no source primitive`).toBeDefined();
      const wedgeIndex = Math.floor(lead.combinationIndex / PRIMITIVES.length);
      expect(wedgeCompatible(wedgeAt(space, wedgeIndex), primitive!.tags)).toBe(true);
    }
  });

  it('gives two callers different leads from the same inputs', () => {
    const space = loadWedges();
    const args = { primitives: PRIMITIVES, space, day: '2026-08-25', cursor: 0, limit: 10 };
    const a = composeLeads({ ...args, ownerKey: 'user:1' }).leads.map((l) => l.slug);
    const b = composeLeads({ ...args, ownerKey: 'user:2' }).leads.map((l) => l.slug);
    expect(a.filter((s) => b.includes(s)).length).toBeLessThanOrEqual(2);
  });

  it('never repeats a lead while paging', () => {
    const space = loadWedges();
    const seen = new Set<string>();
    let cursor = 0;
    for (let page = 0; page < 5; page++) {
      const res = composeLeads({
        primitives: PRIMITIVES, space, ownerKey: 'user:1',
        day: '2026-08-25', cursor, limit: 8,
      });
      for (const lead of res.leads) {
        expect(seen.has(lead.slug), `repeat: ${lead.slug}`).toBe(false);
        seen.add(lead.slug);
      }
      expect(res.nextCursor).not.toBeNull();
      cursor = res.nextCursor!;
    }
    expect(seen.size).toBe(40);
  });

  it('is deterministic for the same caller, day and cursor', () => {
    const space = loadWedges();
    const args = {
      primitives: PRIMITIVES, space, ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 6,
    };
    expect(composeLeads(args).leads.map((l) => l.slug))
      .toEqual(composeLeads(args).leads.map((l) => l.slug));
  });

  it('honours avoided sectors', () => {
    const withSector = [prim('P9', 'Storefront sellers drown in returns', ['commerce'], 80)];
    withSector[0].sector = 'commerce';
    const res = composeLeads({
      primitives: withSector, space: loadWedges(), ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 5, avoidSectors: ['commerce'],
    });
    expect(res.leads).toHaveLength(0);
  });

  it('skips slugs the caller has already seen', () => {
    const space = loadWedges();
    const first = composeLeads({
      primitives: PRIMITIVES, space, ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 3,
    });
    const exclude = new Set(first.leads.map((l) => l.slug));
    const second = composeLeads({
      primitives: PRIMITIVES, space, ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 3, excludeSlugs: exclude,
    });
    expect(second.leads.every((l) => !exclude.has(l.slug))).toBe(true);
  });

  it('returns nothing when there are no primitives', () => {
    const res = composeLeads({
      primitives: [], space: loadWedges(), ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 5,
    });
    expect(res.leads).toEqual([]);
    expect(res.spaceSize).toBe(0);
  });

  it('scores every lead within 0..100', () => {
    const res = composeLeads({
      primitives: PRIMITIVES, space: loadWedges(), ownerKey: 'user:1',
      day: '2026-08-25', cursor: 0, limit: 15,
    });
    for (const lead of res.leads) {
      expect(lead.heuristicScore).toBeGreaterThanOrEqual(0);
      expect(lead.heuristicScore).toBeLessThanOrEqual(100);
    }
  });
});

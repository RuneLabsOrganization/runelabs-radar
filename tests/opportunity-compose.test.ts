import { beforeEach, describe, expect, it } from 'vitest';
import { composeLeads } from '@/lib/opportunities/compose';
import { loadWedges, seedWedges, wedgeCompatible, wedgeAt } from '@/lib/opportunities/wedges';
import type { WedgeAxis, WedgeSpace, WedgeValue } from '@/lib/opportunities/wedges';
import type { Primitive, PrimitiveType } from '@/lib/opportunities/primitives';
import { useTestDb } from './helpers/db';

function prim(
  ref: string,
  label: string,
  tags: string[],
  intensity = 50,
  type: PrimitiveType = 'pain',
): Primitive {
  return { ref, type, label, sector: null, tags, intensity };
}

/** One-value-per-axis space with no tag rules — both primitives share the wedge. */
function openWedgeSpace(): WedgeSpace {
  return weightedWedgeSpace(10);
}

/** Taxonomy extremes today are weight 8 (weakest) and 15 (strongest). */
function weightedWedgeSpace(weight: number): WedgeSpace {
  const val = (axis: WedgeAxis, id: number): WedgeValue => ({
    id,
    axis,
    slug: `w${weight}-${axis}`,
    label: `W${weight} ${axis}`,
    requiresTags: [],
    excludesTags: [],
    weight,
  });
  return {
    business_model: [val('business_model', 1)],
    delivery_form: [val('delivery_form', 2)],
    buyer: [val('buyer', 3)],
    moat_play: [val('moat_play', 4)],
  };
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

  it('frames a pain thesis as a buyer being hit by the need', () => {
    const res = composeLeads({
      primitives: [prim('P1', 'Code review backlogs block small teams', ['devtools'])],
      space: loadWedges(),
      ownerKey: 'user:1',
      day: '2026-08-25',
      cursor: 0,
      limit: 1,
    });
    expect(res.leads).toHaveLength(1);
    expect(res.leads[0].thesisSkeleton).toContain('are hit by');
  });

  it('frames a story thesis as something that just became available, not a pain', () => {
    const res = composeLeads({
      primitives: [prim('S1', 'A new open-source model dropped', ['devtools'], 50, 'story')],
      space: loadWedges(),
      ownerKey: 'user:1',
      day: '2026-08-25',
      cursor: 0,
      limit: 1,
    });
    expect(res.leads).toHaveLength(1);
    expect(res.leads[0].thesisSkeleton).toContain('just became available or cheap');
    expect(res.leads[0].thesisSkeleton).not.toContain('are hit by');
  });

  it('frames a pattern thesis as a signal, not a pain', () => {
    const res = composeLeads({
      primitives: [prim('A1', 'Weekly MCP server launches keep climbing', ['devtools'], 50, 'pattern')],
      space: loadWedges(),
      ownerKey: 'user:1',
      day: '2026-08-25',
      cursor: 0,
      limit: 1,
    });
    expect(res.leads).toHaveLength(1);
    expect(res.leads[0].thesisSkeleton).toContain('Signal:');
    expect(res.leads[0].thesisSkeleton).not.toContain('are hit by');
  });

  it('scores a pain strictly above a same-intensity story on the same wedge', () => {
    const space = openWedgeSpace();
    const pain = prim('P1', 'Code review backlogs block small teams', ['devtools'], 80);
    const story = prim('S1', 'A new open-source model dropped', ['devtools'], 80, 'story');
    const res = composeLeads({
      primitives: [pain, story],
      space,
      ownerKey: 'user:1',
      day: '2026-08-25',
      cursor: 0,
      limit: 2,
    });
    expect(res.leads).toHaveLength(2);
    const painLead = res.leads.find((l) => l.primitiveRefs.includes('P1'));
    const storyLead = res.leads.find((l) => l.primitiveRefs.includes('S1'));
    expect(painLead).toBeDefined();
    expect(storyLead).toBeDefined();
    expect(painLead!.heuristicScore).toBeGreaterThan(storyLead!.heuristicScore);
  });

  it('scores a pain on the weakest wedge above a same-intensity story on the strongest', () => {
    const pain = prim('P1', 'Code review backlogs block small teams', ['devtools'], 80);
    const story = prim('S1', 'A new open-source model dropped', ['devtools'], 80, 'story');
    const painLead = composeLeads({
      primitives: [pain],
      space: weightedWedgeSpace(8),
      ownerKey: 'user:1',
      day: '2026-08-25',
      cursor: 0,
      limit: 1,
    }).leads[0];
    const storyLead = composeLeads({
      primitives: [story],
      space: weightedWedgeSpace(15),
      ownerKey: 'user:1',
      day: '2026-08-25',
      cursor: 0,
      limit: 1,
    }).leads[0];
    expect(painLead).toBeDefined();
    expect(storyLead).toBeDefined();
    expect(painLead!.heuristicScore).toBeGreaterThan(storyLead!.heuristicScore);
  });
});

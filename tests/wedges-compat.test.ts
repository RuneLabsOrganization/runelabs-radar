import { beforeEach, describe, expect, it } from 'vitest';
import {
  isCompatible, loadWedges, wedgeAt, wedgeSpaceSize, seedWedges, WEDGE_AXES,
} from '@/lib/opportunities/wedges';
import type { WedgeValue } from '@/lib/opportunities/wedges';
import { useTestDb } from './helpers/db';

function value(slug: string, requires: string[], excludes: string[]): WedgeValue {
  return {
    id: 1, axis: 'moat_play', slug, label: slug,
    requiresTags: requires, excludesTags: excludes, weight: 10,
  };
}

describe('wedge compatibility', () => {
  it('accepts a value with no rules', () => {
    expect(isCompatible(value('plain', [], []), ['devtools'])).toBe(true);
  });

  it('requires ALL requiresTags to be present', () => {
    const v = value('needs-both', ['data', 'regulated'], []);
    expect(isCompatible(v, ['data'])).toBe(false);
    expect(isCompatible(v, ['data', 'regulated'])).toBe(true);
  });

  it('rejects when ANY excludesTag is present', () => {
    const v = value('no-consumer', [], ['consumer']);
    expect(isCompatible(v, ['devtools'])).toBe(true);
    expect(isCompatible(v, ['devtools', 'consumer'])).toBe(false);
  });

  it('lets excludes win over requires', () => {
    const v = value('contradictory', ['data'], ['consumer']);
    expect(isCompatible(v, ['data', 'consumer'])).toBe(false);
  });
});

describe('wedge space', () => {
  beforeEach(() => {
    useTestDb();
    seedWedges();
  });

  it('loads values grouped by axis', () => {
    const space = loadWedges();
    for (const axis of WEDGE_AXES) {
      expect(space[axis].length, `axis ${axis}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('reports the full cross-product size', () => {
    const space = loadWedges();
    const expected = WEDGE_AXES.reduce((n, a) => n * space[a].length, 1);
    expect(wedgeSpaceSize(space)).toBe(expected);
    expect(wedgeSpaceSize(space)).toBeGreaterThan(1000);
  });

  it('decodes every index in range to a distinct wedge', () => {
    const space = loadWedges();
    const n = Math.min(wedgeSpaceSize(space), 500);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const w = wedgeAt(space, i);
      const key = WEDGE_AXES.map((a) => w[a].slug).join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('throws a clear error on a zero-active-values axis instead of drifting into NaN (F14)', () => {
    const space = loadWedges();
    const degenerate = { ...space, buyer: [] };
    // pre-fix: rest % 0 = NaN silently poisoned the decode — safe only because
    // composeLeads happened to early-return on spaceSize===0
    expect(() => wedgeAt(degenerate, 0)).toThrow(/no active values/);
  });
});

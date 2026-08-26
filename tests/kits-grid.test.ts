import { describe, it, expect } from 'vitest';
import { KIT_CATEGORIES, KIT_GRID, KIT_TIERS, allCells, isKitCell } from '@/lib/kits/grid';

describe('kit grid', () => {
  it('has 9 categories and 28 cells', () => {
    expect(KIT_CATEGORIES).toHaveLength(9);
    expect(allCells()).toHaveLength(28);
  });

  it('defines a task list for every category', () => {
    for (const c of KIT_CATEGORIES) {
      expect(KIT_GRID[c].length).toBeGreaterThan(0);
    }
  });

  it('has three tiers', () => {
    expect(KIT_TIERS).toEqual(['best', 'value', 'cheapest']);
  });

  it('validates cells', () => {
    expect(isKitCell('video', 'avatar')).toBe(true);
    expect(isKitCell('video', 'avatar/talking-head')).toBe(false);
    expect(isKitCell('nope', 'avatar')).toBe(false);
  });

  it('has no duplicate tasks within a category', () => {
    for (const c of KIT_CATEGORIES) {
      expect(new Set(KIT_GRID[c]).size).toBe(KIT_GRID[c].length);
    }
  });
});

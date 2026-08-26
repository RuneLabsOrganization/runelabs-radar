import { describe, it, expect } from 'vitest';
import { KIT_PERSONAS, KIT_PERSONA_SLUGS, getKitPersona } from '@/lib/kits/personas';
import { allCells, isKitCell, isKitTier } from '@/lib/kits/grid';

describe('kit personas', () => {
  it('ships 11 personas with unique slugs', () => {
    expect(KIT_PERSONAS).toHaveLength(11);
    expect(new Set(KIT_PERSONA_SLUGS).size).toBe(11);
  });

  // The invariant that keeps the roster and the grid from drifting apart.
  it('every route points at a real grid cell', () => {
    for (const p of KIT_PERSONAS) {
      expect(p.routes.length).toBeGreaterThan(0);
      for (const r of p.routes) {
        expect(isKitCell(r.category, r.task), `${p.slug} → ${r.category}/${r.task}`).toBe(true);
      }
    }
  });

  it('every persona has a valid default tier', () => {
    for (const p of KIT_PERSONAS) {
      expect(isKitTier(p.defaultTier), p.slug).toBe(true);
    }
  });

  // Any orphan cell is content nobody will ever see.
  it('every grid cell is claimed by at least one persona', () => {
    const claimed = new Set(
      KIT_PERSONAS.flatMap((p) => p.routes.map((r) => `${r.category}/${r.task}`)),
    );
    const orphans = allCells()
      .map((c) => `${c.category}/${c.task}`)
      .filter((k) => !claimed.has(k));
    expect(orphans).toEqual([]);
  });

  it('has no duplicate routes within a persona', () => {
    for (const p of KIT_PERSONAS) {
      const keys = p.routes.map((r) => `${r.category}/${r.task}`);
      expect(new Set(keys).size, p.slug).toBe(keys.length);
    }
  });

  it('resolves by slug and returns null for unknown', () => {
    expect(getKitPersona('ugc-creator')?.label).toBe('UGC creator');
    expect(getKitPersona('nope')).toBeNull();
  });
});

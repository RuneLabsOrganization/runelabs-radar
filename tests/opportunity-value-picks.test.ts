import { describe, expect, it } from 'vitest';
import { valuePicks, VALUE_PICK_MIN_INTELLIGENCE } from '@/lib/opportunities/value-picks';
import type { AaModel } from '@/lib/pareto';

function model(
  name: string,
  intelligence: number,
  price: number,
  sides: { priceIn?: number | null; priceOut?: number | null } = {},
): AaModel {
  return {
    name,
    org: null,
    intelligence,
    coding: null,
    price,
    priceIn: sides.priceIn === undefined ? price : sides.priceIn,
    priceOut: sides.priceOut === undefined ? price : sides.priceOut,
    speed: null,
    released: null,
  };
}

describe('valuePicks (F3 — the one intelligence-per-dollar ranking)', () => {
  it('never lets a free SKU top the list — price 0 is excluded, not Infinity', () => {
    // pre-fix brief.ts/critic.ts divided by price with no guard: a free model
    // sorted as Infinity to the top of the prompt
    const picks = valuePicks(
      [model('free-lunch', 100, 0), model('solid', 80, 1), model('pricey', 90, 10)],
      { limit: 3 },
    );
    expect(picks.map((m) => m.name)).not.toContain('free-lunch');
    expect(picks[0]!.name).toBe('solid'); // 80/1 beats 90/10
  });

  it('does not NaN the comparator when two models are both zero-price', () => {
    // pre-fix: Infinity - Infinity = NaN inside sort — undefined ordering
    const picks = valuePicks(
      [model('free-a', 90, 0), model('free-b', 95, 0), model('paid', 70, 2)],
      { limit: 5 },
    );
    expect(picks).toHaveLength(1);
    expect(picks[0]!.name).toBe('paid');
  });

  it('applies the documented intelligence floor regardless of price', () => {
    const picks = valuePicks(
      [model('dirt-cheap-but-dumb', VALUE_PICK_MIN_INTELLIGENCE - 1, 0.01), model('smart', 60, 5)],
      { limit: 5 },
    );
    expect(picks.map((m) => m.name)).toEqual(['smart']);
  });

  it('ranks by intelligence per blended dollar, strongest first', () => {
    const picks = valuePicks(
      [model('a', 50, 1), model('b', 90, 3), model('c', 80, 2)],
      { limit: 3 },
    );
    // ratios: a 50, b 30, c 40
    expect(picks.map((m) => m.name)).toEqual(['a', 'c', 'b']);
  });

  it('requireBothSides keeps only fully-priced models (brief/realist rendering)', () => {
    const picks = valuePicks(
      [model('one-sided', 90, 1, { priceOut: null }), model('full', 80, 2)],
      { limit: 5, requireBothSides: true },
    );
    expect(picks.map((m) => m.name)).toEqual(['full']);
  });

  it('all three consumers see one consistent order for the models they share', () => {
    // engine: { limit: 8 } — brief/realist: { limit: 6, requireBothSides: true }
    const pool = [
      model('free', 100, 0),
      model('one-sided', 95, 0.5, { priceIn: null }),
      model('a', 50, 1),
      model('b', 90, 3),
      model('c', 80, 2),
      model('d', 70, 1.5),
    ];
    const enginePicks = valuePicks(pool, { limit: 8 });
    const briefPicks = valuePicks(pool, { limit: 6, requireBothSides: true });
    const shared = briefPicks.map((m) => m.name);
    const engineShared = enginePicks.map((m) => m.name).filter((n) => shared.includes(n));
    expect(engineShared).toEqual(shared); // same order, never divergent copies
    expect(enginePicks.map((m) => m.name)).toContain('one-sided'); // engine shows single-sided
  });
});

import { describe, expect, it } from 'vitest';
import { paretoFrontier } from '@/lib/pareto';

describe('paretoFrontier duplicate semantics', () => {
  it('keeps exact duplicates together on the frontier', () => {
    expect(paretoFrontier([{ x: 1, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 4 }])).toEqual([true, true, false]);
  });

  it('keeps duplicates even when interleaved with other points', () => {
    expect(paretoFrontier([{ x: 1, y: 5 }, { x: 3, y: 7 }, { x: 1, y: 5 }])).toEqual([true, true, true]);
  });

  it('does not keep duplicates of a dominated point', () => {
    expect(paretoFrontier([{ x: 1, y: 10 }, { x: 2, y: 5 }, { x: 2, y: 5 }])).toEqual([true, false, false]);
  });

  it('still drops a pricier point that is only equal, not better', () => {
    expect(paretoFrontier([{ x: 1, y: 5 }, { x: 2, y: 5 }])).toEqual([true, false]);
  });

  it('matches the classic frontier on distinct points', () => {
    expect(paretoFrontier([{ x: 1, y: 4 }, { x: 2, y: 5 }, { x: 3, y: 3 }])).toEqual([true, true, false]);
  });
});

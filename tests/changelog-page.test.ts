import { describe, expect, it } from 'vitest';
import { changelogSummary } from '@/lib/changelog';

describe('changelogSummary', () => {
  it('counts contacts and moves, finds the dominant sector', () => {
    const s = changelogSummary(['coding', 'video', 'coding', null, 'coding', 'video'], ['video', 'ads']);
    expect(s.contacts).toBe(6);
    expect(s.moves).toBe(2);
    expect(s.topSector).toBe('coding');
  });

  it('returns null sector when nothing is scored', () => {
    const s = changelogSummary([null, null], []);
    expect(s.topSector).toBeNull();
    expect(s.contacts).toBe(2);
  });

  it('handles the empty window', () => {
    expect(changelogSummary([], [])).toEqual({ contacts: 0, moves: 0, topSector: null });
  });
});

import { describe, it, expect } from 'vitest';
import { boardCellToKitCell, TIER_BY_FIELD } from '@/lib/kits/from-board';

describe('board cell -> kit cell', () => {
  it('maps a matching domain/task straight through', () => {
    expect(boardCellToKitCell('coding', 'agentic-coding')).toEqual({
      category: 'coding',
      task: 'agentic-coding',
    });
  });

  it('applies the avatar rename', () => {
    expect(boardCellToKitCell('video', 'avatar/talking-head')).toEqual({
      category: 'video',
      task: 'avatar',
    });
  });

  it('returns null for a cell outside the grid', () => {
    expect(boardCellToKitCell('coding', 'not-a-real-task')).toBeNull();
    expect(boardCellToKitCell('nonsense', 'agentic-coding')).toBeNull();
  });

  it('maps all three board columns to the three tiers', () => {
    expect(TIER_BY_FIELD.bestOverall).toBe('best');
    expect(TIER_BY_FIELD.bestValue).toBe('value');
    expect(TIER_BY_FIELD.cheapestViable).toBe('cheapest');
  });
});

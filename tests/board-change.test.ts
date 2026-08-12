import { describe, expect, it } from 'vitest';
import { formatBoardChange, isNoopChange } from '@/lib/board/change';

describe('isNoopChange', () => {
  it('detects noise rows', () => {
    expect(isNoopChange('no field changes')).toBe(true);
    expect(isNoopChange('  No Field Changes. ')).toBe(true);
    expect(isNoopChange('bestOverall: A -> B')).toBe(false);
  });
});

describe('formatBoardChange', () => {
  it('splits fields and formats arrows', () => {
    const out = formatBoardChange(
      'bestOverall: Gemini Omni Flash (Google) -> HappyHorse-1.1 (Alibaba-ATH); cheapestViable: Veo 3.1 -> Wan 2.7',
    );
    expect(out).toEqual([
      { field: 'best overall', text: 'Gemini Omni Flash (Google) → HappyHorse-1.1 (Alibaba-ATH)' },
      { field: 'cheapest viable', text: 'Veo 3.1 → Wan 2.7' },
    ]);
  });

  it('summarizes cost-note and verdict dumps instead of printing them', () => {
    const out = formatBoardChange('costNote: Gemini: ~$0.07/sec (est.); Kling: ~$0.06/sec -> HappyHorse: ~$0.08/sec');
    expect(out).toEqual([{ field: 'cost note', text: 'updated' }]);
  });

  it('returns [] for noise and empty input', () => {
    expect(formatBoardChange('no field changes')).toEqual([]);
    expect(formatBoardChange('')).toEqual([]);
  });

  it('clips over-long values with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const out = formatBoardChange(`bestOverall: ${long} -> B`);
    expect(out[0].text.length).toBeLessThan(120);
    expect(out[0].text).toContain('…');
  });
});

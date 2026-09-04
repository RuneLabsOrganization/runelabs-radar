import { describe, it, expect } from 'vitest';
import { scatterPriceLabel } from '@/components/ModelScatter';

describe('scatterPriceLabel — ModelScatter hover price', () => {
  it('formats compact USD instead of raw floats', () => {
    expect(scatterPriceLabel(0.37)).toBe('$0.37/1M');
    expect(scatterPriceLabel(12.5)).toBe('$12.5/1M');
    expect(scatterPriceLabel(150)).toBe('$150/1M');
  });

  it('never leaks binary-float noise', () => {
    // 0.1 + 0.2 style prices used to print "$0.30000000000000004/1M"
    expect(scatterPriceLabel(0.1 + 0.2)).toBe('$0.3/1M');
  });
});

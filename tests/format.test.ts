import { describe, expect, it } from 'vitest';
import { fmtCompact, fmtDurationMs, fmtPct, fmtUsdCompact } from '@/lib/format';

describe('fmtCompact', () => {
  it('escalates k/M/B and FLOORS (the round-down ethos)', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(87)).toBe('87');
    expect(fmtCompact(999)).toBe('999');
    expect(fmtCompact(1000)).toBe('1k');
    expect(fmtCompact(1530)).toBe('1.5k');
    expect(fmtCompact(1999)).toBe('1.9k'); // floored — never "2k" from 1999
    expect(fmtCompact(999_999)).toBe('999.9k'); // escalates instead of "1000k"
    expect(fmtCompact(1_000_000)).toBe('1M');
    expect(fmtCompact(1_999_999)).toBe('1.9M');
    expect(fmtCompact(2_500_000_000)).toBe('2.5B');
  });

  it('keeps small floats without binary noise and signs negatives', () => {
    expect(fmtCompact(0.30000000000000004)).toBe('0.3');
    expect(fmtCompact(-1530)).toBe('-1.5k');
    expect(fmtCompact(-5)).toBe('-5');
  });
});

describe('fmtUsdCompact', () => {
  it('formats with $ and leads the sign', () => {
    expect(fmtUsdCompact(900)).toBe('$900');
    expect(fmtUsdCompact(12_500)).toBe('$12.5k');
    expect(fmtUsdCompact(1_200_000)).toBe('$1.2M');
    expect(fmtUsdCompact(-5)).toBe('-$5');
  });
});

describe('fmtPct', () => {
  it('is null on no-data — never renders as if it were 0', () => {
    expect(fmtPct(null)).toBeNull();
    expect(fmtPct(NaN)).toBeNull();
    expect(fmtPct(Infinity)).toBeNull();
  });

  it('one precision regime, explicit sign', () => {
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(5.25)).toBe('+5.3%');
    expect(fmtPct(-5.25)).toBe('-5.3%');
    expect(fmtPct(12.4)).toBe('+12%');
    expect(fmtPct(-200)).toBe('-200%');
  });
});

describe('fmtDurationMs', () => {
  it('one regime for every jobs surface', () => {
    expect(fmtDurationMs(120)).toBe('120ms');
    expect(fmtDurationMs(65_040)).toBe('65.0s'); // same string in both jobs panels
    expect(fmtDurationMs(190_000)).toBe('3.2m');
    expect(fmtDurationMs(5_400_000)).toBe('1.5h');
    expect(fmtDurationMs(-1)).toBe('—');
  });
});

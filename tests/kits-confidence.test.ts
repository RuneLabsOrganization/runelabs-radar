import { describe, it, expect } from 'vitest';
import { gradeConfidence } from '@/lib/kits/confidence';

const NOW = new Date('2026-08-26T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('gradeConfidence', () => {
  it('is high with volume, source spread and recency', () => {
    expect(
      gradeConfidence({ evidenceCount: 20, distinctSources: 3, verifiedAt: daysAgo(3), now: NOW }),
    ).toBe('high');
  });

  it('is med when volume is there but sources are thin', () => {
    expect(
      gradeConfidence({ evidenceCount: 40, distinctSources: 2, verifiedAt: daysAgo(3), now: NOW }),
    ).toBe('med');
  });

  it('is low below the volume floor', () => {
    expect(
      gradeConfidence({ evidenceCount: 4, distinctSources: 4, verifiedAt: daysAgo(1), now: NOW }),
    ).toBe('low');
  });

  it('demotes high to med past 14 days', () => {
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(20), now: NOW }),
    ).toBe('med');
  });

  it('demotes a tier past 45 days', () => {
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(60), now: NOW }),
    ).toBe('med');
    expect(
      gradeConfidence({ evidenceCount: 6, distinctSources: 2, verifiedAt: daysAgo(60), now: NOW }),
    ).toBe('low');
  });

  it('is low past 90 days no matter the volume', () => {
    expect(
      gradeConfidence({ evidenceCount: 500, distinctSources: 40, verifiedAt: daysAgo(120), now: NOW }),
    ).toBe('low');
  });

  it('is low when never verified', () => {
    expect(
      gradeConfidence({ evidenceCount: 500, distinctSources: 40, verifiedAt: null, now: NOW }),
    ).toBe('low');
  });

  it('requires a genuinely independent domain before passing low', () => {
    // JUSTIFICATION (G3): runKitGrade now passes independentDomains (previously
    // no caller did, so the gate was dead). Vendor-only corroboration cannot
    // outrank 'low' however much of it there is.
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(1), independentDomains: 0, now: NOW }),
    ).toBe('low');
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(1), independentDomains: 1, now: NOW }),
    ).toBe('high');
  });

  it('skips the independence gate when the caller has not computed it', () => {
    expect(
      gradeConfidence({ evidenceCount: 50, distinctSources: 9, verifiedAt: daysAgo(1), now: NOW }),
    ).toBe('high');
  });
});

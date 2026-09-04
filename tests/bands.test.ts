import { describe, it, expect } from 'vitest';
import { rubricBand, signalLevel, SCAN_MIN, TOP_SIGNAL_MIN } from '@/lib/bands';
import {
  SCAN_MIN as feedScanMin,
  TOP_SIGNAL_MIN as feedTopSignalMin,
  signalLevel as feedSignalLevel,
  rubricBand as feedRubricBand,
} from '@/lib/feed';

describe('bands — the threshold atlas', () => {
  it('rubricBand reproduces the curation prompt cutoffs', () => {
    expect(rubricBand(0)).toBe('irrelevant');
    expect(rubricBand(19)).toBe('irrelevant');
    expect(rubricBand(20)).toBe('tangential');
    expect(rubricBand(39)).toBe('tangential');
    expect(rubricBand(40)).toBe('relevant');
    expect(rubricBand(59)).toBe('relevant');
    expect(rubricBand(60)).toBe('important');
    expect(rubricBand(79)).toBe('important');
    expect(rubricBand(80)).toBe('critical');
    expect(rubricBand(100)).toBe('critical');
  });

  it('a 70–79 story gets a coherent label on every owned surface', () => {
    // rubric "important", 3 signal bars, and a top-signal slot — one story,
    // one story-worth, no surface disagreeing with its neighbor
    expect(rubricBand(75)).toBe('important');
    expect(signalLevel(75)).toBe(3);
    expect(75).toBeGreaterThanOrEqual(TOP_SIGNAL_MIN);
    expect(75).toBeGreaterThanOrEqual(SCAN_MIN);
  });

  it('signal bars spell the rubric: 40/60/80 = relevant/important/critical', () => {
    expect(signalLevel(0)).toBe(1);
    expect(signalLevel(39)).toBe(1);
    expect(signalLevel(40)).toBe(2);
    expect(signalLevel(60)).toBe(3);
    expect(signalLevel(80)).toBe(4);
  });

  it('feed.ts re-exports the canonical values (single source)', () => {
    expect(feedScanMin).toBe(SCAN_MIN);
    expect(feedTopSignalMin).toBe(TOP_SIGNAL_MIN);
    expect(feedSignalLevel).toBe(signalLevel);
    expect(feedRubricBand).toBe(rubricBand);
  });
});

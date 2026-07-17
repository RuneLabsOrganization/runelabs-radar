import { describe, it, expect } from 'vitest';
import { signalLevel, splitFeed, timeAgo, TOP_MAX } from '@/lib/feed';
import { filterBySector, type FeedEntry } from '@/components/FilteredFeed';

function contact(score: number, minutesAgo: number) {
  return { score, createdAt: new Date(Date.now() - minutesAgo * 60_000) };
}

describe('signalLevel', () => {
  it('maps score bands to 1-4 bars', () => {
    expect(signalLevel(0)).toBe(1);
    expect(signalLevel(39)).toBe(1);
    expect(signalLevel(40)).toBe(2);
    expect(signalLevel(59)).toBe(2);
    expect(signalLevel(60)).toBe(3);
    expect(signalLevel(79)).toBe(3);
    expect(signalLevel(80)).toBe(4);
    expect(signalLevel(100)).toBe(4);
  });
});

describe('splitFeed', () => {
  it('splits into top signals (score order), scan log (newest first), and low count', () => {
    const a = contact(92, 300);
    const b = contact(75, 10);
    const c = contact(55, 200);
    const d = contact(45, 5);
    const e = contact(20, 1);
    const { top, scan, lowCount } = splitFeed([c, e, a, d, b]);
    expect(top).toEqual([a, b]);
    expect(scan).toEqual([d, c]); // newest first, not score order
    expect(lowCount).toBe(1);
  });

  it('caps top signals at TOP_MAX and overflows into the scan log', () => {
    const many = Array.from({ length: 12 }, (_, i) => contact(90 - i, i));
    const { top, scan } = splitFeed(many);
    expect(top).toHaveLength(TOP_MAX);
    expect(top[0].score).toBe(90);
    expect(scan).toHaveLength(4);
    // overflow entries keep their scores >= 70 but live in the scan log
    expect(scan.every((s) => s.score >= 70)).toBe(true);
  });

  it('handles an empty scope', () => {
    expect(splitFeed([])).toEqual({ top: [], scan: [], lowCount: 0 });
  });
});

describe('filterBySector', () => {
  const entry = (id: number, scores: Record<string, number>): FeedEntry => ({
    story: {
      id,
      title: `s${id}`,
      tldr: null,
      whyItMatters: null,
      domainScores: JSON.stringify(scores),
      topScore: 50,
      createdAt: new Date(),
    },
    itemCount: 1,
    firstUrl: null,
    sourceName: null,
    up: 0,
    down: 0,
    myVote: 0,
    isNew: false,
    score: 50,
  });

  it('keeps entries at or above the membership threshold for the sector', () => {
    const entries = [entry(1, { coding: 80 }), entry(2, { coding: 39, video: 60 }), entry(3, { video: 40 })];
    expect(filterBySector(entries, null)).toHaveLength(3);
    expect(filterBySector(entries, 'coding').map((e) => e.story.id)).toEqual([1]);
    expect(filterBySector(entries, 'video').map((e) => e.story.id)).toEqual([2, 3]);
    expect(filterBySector(entries, 'ads')).toEqual([]);
  });
});

describe('timeAgo', () => {
  it('formats relative times compactly', () => {
    expect(timeAgo(new Date(Date.now() - 30_000))).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe('5m ago');
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000))).toBe('3h ago');
    expect(timeAgo(new Date(Date.now() - 49 * 3600_000))).toBe('2d ago');
  });
});

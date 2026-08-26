import { describe, it, expect } from 'vitest';
import { domainAffinity, groupByDomain, personalScore, signalLevel, splitFeed, timeAgo, AFFINITY_MAX_BOOST, TOP_MAX } from '@/lib/feed';
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
      whyShown: null,
      domainScores: JSON.stringify(scores),
      topScore: 50,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    itemCount: 1,
    firstUrl: null,
    sourceName: null,
    up: 0,
    down: 0,
    myVote: 0,
    isNew: false,
    score: 50,
    timeLabel: 'just now',
  });

  it('keeps entries at or above the membership threshold for the sector', () => {
    const entries = [entry(1, { coding: 80 }), entry(2, { coding: 39, video: 60 }), entry(3, { video: 40 })];
    expect(filterBySector(entries, null)).toHaveLength(3);
    expect(filterBySector(entries, 'coding').map((e) => e.story.id)).toEqual([1]);
    expect(filterBySector(entries, 'video').map((e) => e.story.id)).toEqual([2, 3]);
    expect(filterBySector(entries, 'ads')).toEqual([]);
  });
});

describe('domainAffinity', () => {
  it('builds a taste vector from up/down votes', () => {
    const affinity = domainAffinity([
      { value: 1, domainScores: JSON.stringify({ coding: 80, agentic: 60 }) },
      { value: 1, domainScores: JSON.stringify({ coding: 60 }) },
      { value: -1, domainScores: JSON.stringify({ video: 90 }) },
    ]);
    expect(affinity.coding).toBeCloseTo(0.7); // mean upvote 70, no downvotes
    expect(affinity.agentic).toBeCloseTo(0.6);
    expect(affinity.video).toBeCloseTo(-0.9);
  });

  it('nets upvotes against downvotes per domain', () => {
    const affinity = domainAffinity([
      { value: 1, domainScores: JSON.stringify({ coding: 80 }) },
      { value: -1, domainScores: JSON.stringify({ coding: 40 }) },
    ]);
    expect(affinity.coding).toBeCloseTo(0.4); // (80 − 40) / 100
  });

  it('ignores zero values and malformed JSON', () => {
    expect(domainAffinity([{ value: 0, domainScores: JSON.stringify({ coding: 80 }) }])).toEqual({});
    expect(domainAffinity([{ value: 1, domainScores: 'not json' }])).toEqual({});
  });
});

describe('personalScore', () => {
  it('boosts stories in domains the user upvotes', () => {
    const affinity = domainAffinity([{ value: 1, domainScores: JSON.stringify({ coding: 100 }) }]);
    // affinity coding = 1 → boost = 1 × 0.8 × 12 ≈ 10
    expect(personalScore(50, JSON.stringify({ coding: 80 }), affinity)).toBe(60);
  });

  it('penalizes domains the user only downvotes', () => {
    const affinity = domainAffinity([{ value: -1, domainScores: JSON.stringify({ video: 100 }) }]);
    expect(personalScore(50, JSON.stringify({ video: 100 }), affinity)).toBe(50 - AFFINITY_MAX_BOOST);
  });

  it('caps the boost and never leaves [0, 100]', () => {
    expect(personalScore(97, JSON.stringify({ coding: 100 }), { coding: 1 })).toBe(100);
    expect(personalScore(3, JSON.stringify({ coding: 100 }), { coding: -1 })).toBe(0);
  });

  it('uses the single best-matching domain rather than stacking', () => {
    const affinity = { coding: 1, agentic: 1 };
    const one = personalScore(50, JSON.stringify({ coding: 50 }), affinity);
    const two = personalScore(50, JSON.stringify({ coding: 50, agentic: 50 }), affinity);
    expect(two).toBe(one);
  });

  it('is a no-op with empty affinity or malformed scores', () => {
    expect(personalScore(50, JSON.stringify({ coding: 80 }), {})).toBe(50);
    expect(personalScore(50, 'junk', { coding: 1 })).toBe(50);
  });
});

describe('groupByDomain', () => {
  it('chunks by primary domain, strongest-scoring group first, uncategorized last', () => {
    const items = [
      { id: 1, d: 'video', s: 45 },
      { id: 2, d: 'coding', s: 68 },
      { id: 3, d: null, s: 55 },
      { id: 4, d: 'video', s: 72 },
      { id: 5, d: 'coding', s: 50 },
    ];
    const groups = groupByDomain(items, (i) => i.d, (i) => i.s);
    expect(groups.map((g) => g.domain)).toEqual(['video', 'coding', null]);
    expect(groups[0].items.map((i) => i.id)).toEqual([1, 4]); // input order preserved
    expect(groups[1].items.map((i) => i.id)).toEqual([2, 5]);
    expect(groups[2].items.map((i) => i.id)).toEqual([3]);
  });

  it('handles an empty list', () => {
    expect(groupByDomain([], (i: { d: string | null }) => i.d, () => 0)).toEqual([]);
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

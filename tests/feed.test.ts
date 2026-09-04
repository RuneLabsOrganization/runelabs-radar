import { describe, it, expect } from 'vitest';
import {
  domainAffinity,
  groupByDomain,
  personalScore,
  signalLevel,
  splitCompleteDays,
  splitFeed,
  timeAgo,
  utcDateLine,
  AFFINITY_MAX_BOOST,
  AFFINITY_PRIOR_VOTES,
  TOP_MAX,
} from '@/lib/feed';
import { utcDay } from '@/lib/metrics';
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
  it('builds a shrunk taste vector from up/down votes', () => {
    const affinity = domainAffinity([
      { value: 1, domainScores: JSON.stringify({ coding: 80, agentic: 60 }) },
      { value: 1, domainScores: JSON.stringify({ coding: 60 }) },
      { value: -1, domainScores: JSON.stringify({ video: 90 }) },
    ]);
    // raw differences 0.7 / 0.6 / −0.9, shrunk by n/(n+3): n=2 → ×2/5, n=1 → ×1/4
    expect(affinity.coding).toBeCloseTo(0.7 * (2 / 5));
    expect(affinity.agentic).toBeCloseTo(0.6 * (1 / 4));
    expect(affinity.video).toBeCloseTo(-0.9 * (1 / 4));
  });

  it('a single vote barely moves affinity (shrinkage prior)', () => {
    const affinity = domainAffinity([{ value: -1, domainScores: JSON.stringify({ coding: 80 }) }]);
    // the old unshrunk math landed this at −0.8 — near-max penalty from n=1
    expect(affinity.coding).toBeCloseTo(-0.8 / (1 + AFFINITY_PRIOR_VOTES));
    expect(Math.abs(affinity.coding!)).toBeLessThanOrEqual(0.25);
  });

  it('many votes converge to the raw difference', () => {
    const rows = Array.from({ length: 27 }, () => ({
      value: 1,
      domainScores: JSON.stringify({ coding: 80 }),
    }));
    const affinity = domainAffinity(rows);
    // n=27 → shrink factor 27/30 = 0.9 — 90% of the raw 0.8
    expect(affinity.coding).toBeCloseTo(0.8 * 0.9);
  });

  it('nets upvotes against downvotes per domain', () => {
    const affinity = domainAffinity([
      { value: 1, domainScores: JSON.stringify({ coding: 80 }) },
      { value: -1, domainScores: JSON.stringify({ coding: 40 }) },
    ]);
    expect(affinity.coding).toBeCloseTo(0.4 * (2 / 5)); // raw (80 − 40)/100, n=2 shrink
  });

  it('ignores zero values and malformed JSON', () => {
    expect(domainAffinity([{ value: 0, domainScores: JSON.stringify({ coding: 80 }) }])).toEqual({});
    expect(domainAffinity([{ value: 1, domainScores: 'not json' }])).toEqual({});
  });
});

describe('personalScore', () => {
  it('boosts stories in domains the user upvotes', () => {
    // affinity coding = 1 → boost = 1 × 0.8 × 12 ≈ 10
    expect(personalScore(50, JSON.stringify({ coding: 80 }), { coding: 1 })).toBe(60);
  });

  it('penalizes domains the user only downvotes', () => {
    expect(personalScore(50, JSON.stringify({ video: 100 }), { video: -1 })).toBe(50 - AFFINITY_MAX_BOOST);
  });

  it('caps the boost and never leaves [0, 100]', () => {
    expect(personalScore(97, JSON.stringify({ coding: 100 }), { coding: 1 })).toBe(100);
    expect(personalScore(3, JSON.stringify({ coding: 100 }), { coding: -1 })).toBe(0);
  });

  it('uses a single domain rather than stacking', () => {
    const affinity = { coding: 1, agentic: 1 };
    const one = personalScore(50, JSON.stringify({ coding: 50 }), affinity);
    const two = personalScore(50, JSON.stringify({ coding: 50, agentic: 50 }), affinity);
    expect(two).toBe(one);
  });

  it("the story's primary liked domain beats a larger dislike elsewhere", () => {
    // coding 90 (liked, +0.5) vs video 60 (disliked, −1): maxByAbs used to
    // pick the −0.6 dislike; the story's own top domain now has first say
    const scores = JSON.stringify({ coding: 90, video: 60 });
    expect(personalScore(50, scores, { coding: 0.5, video: -1 })).toBe(50 + Math.round(0.45 * AFFINITY_MAX_BOOST));
  });

  it('falls back to the next domain when the primary has no affinity', () => {
    const scores = JSON.stringify({ coding: 90, video: 60 });
    expect(personalScore(50, scores, { video: -1 })).toBe(50 - Math.round(0.6 * AFFINITY_MAX_BOOST));
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

  it('uses wk/mo/yr regimes instead of unbounded days', () => {
    const DAY = 86400_000;
    expect(timeAgo(new Date(Date.now() - 6 * DAY))).toBe('6d ago');
    expect(timeAgo(new Date(Date.now() - 10 * DAY))).toBe('1w ago');
    expect(timeAgo(new Date(Date.now() - 30 * DAY))).toBe('4w ago');
    expect(timeAgo(new Date(Date.now() - 40 * DAY))).toBe('1mo ago');
    expect(timeAgo(new Date(Date.now() - 300 * DAY))).toBe('10mo ago');
    // the "400d ago" regression: bounded regimes, never three-digit days
    expect(timeAgo(new Date(Date.now() - 400 * DAY))).toBe('1y ago');
    expect(timeAgo(new Date(Date.now() - 800 * DAY))).toBe('2y ago');
  });
});

describe('utcDateLine', () => {
  it('labels the day from UTC getters, matching utcDay', () => {
    const d = new Date('2025-02-02T23:30:00Z'); // a Sunday, late in the UTC day
    expect(utcDay(d)).toBe('2025-02-02');
    expect(utcDateLine(d)).toBe('SUN 02 FEB 2025');
  });

  it('never rolls to the next day early the way local getters can', () => {
    // 23:59 UTC is already "tomorrow" in UTC+1 — the label must still name
    // the UTC day the data buckets use
    const d = new Date('2025-06-10T23:59:00Z');
    expect(utcDateLine(d)).toContain('10 JUN 2025');
  });
});

describe('splitCompleteDays', () => {
  const day = (date: string, total = 0) => ({ date, total });

  it('tags the trailing bucket as partial when it is today (UTC)', () => {
    const days = [day('2025-06-08', 4), day('2025-06-09', 7), day('2025-06-10', 2)];
    const { complete, partial } = splitCompleteDays(days, '2025-06-10');
    expect(complete.map((d) => d.date)).toEqual(['2025-06-08', '2025-06-09']);
    expect(partial?.date).toBe('2025-06-10');
  });

  it('leaves complete days untouched when the last bucket is not today', () => {
    const days = [day('2025-06-08'), day('2025-06-09')];
    const { complete, partial } = splitCompleteDays(days, '2025-06-10');
    expect(complete).toHaveLength(2);
    expect(partial).toBeNull();
  });

  it('handles empty and single-bucket series', () => {
    expect(splitCompleteDays([], '2025-06-10')).toEqual({ complete: [], partial: null });
    const single = splitCompleteDays([day('2025-06-10')], '2025-06-10');
    expect(single.complete).toEqual([]);
    expect(single.partial?.date).toBe('2025-06-10');
  });

  it('defaults to the real UTC today', () => {
    const today = utcDay();
    const days = [day('2001-01-01'), day(today)];
    expect(splitCompleteDays(days).partial?.date).toBe(today);
  });
});

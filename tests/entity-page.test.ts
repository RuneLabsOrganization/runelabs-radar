import { beforeEach, describe, expect, it } from 'vitest';
import { boardEntries, stories } from '@/lib/db/schema';
import {
  boardPlacements,
  coMentioned,
  humanizeMetricKey,
  makeDelta,
  metricWeeklyDelta,
  weeklyDelta,
} from '@/lib/entity-extras';
import { useTestDb } from './helpers/db';

describe('makeDelta / weeklyDelta', () => {
  it('computes absolute and percent change', () => {
    expect(makeDelta(15, 10)).toEqual({ current: 15, previous: 10, abs: 5, pct: 50 });
    expect(makeDelta(5, 10).pct).toBe(-50);
    expect(makeDelta(10, 0).pct).toBeNull();
  });

  it('splits a 14d series into last week vs prior week', () => {
    const series = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]; // 7 → 14
    const d = weeklyDelta(series);
    expect(d.previous).toBe(7);
    expect(d.current).toBe(14);
    expect(d.pct).toBe(100);
  });
});

describe('metricWeeklyDelta', () => {
  it('compares latest to the point ~7 days earlier', () => {
    const points = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-05', value: 120 },
      { date: '2026-08-12', value: 150 },
    ];
    const d = metricWeeklyDelta(points)!;
    expect(d.current).toBe(150);
    expect(d.previous).toBe(120); // 08-05 is the latest point ≤ latest−7d
    expect(d.abs).toBe(30);
    // a point AFTER the 7d target must not be chosen
    const d2 = metricWeeklyDelta([
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-06', value: 120 },
      { date: '2026-08-12', value: 150 },
    ])!;
    expect(d2.previous).toBe(100);
  });

  it('falls back to the oldest point when none is 7d old', () => {
    const d = metricWeeklyDelta([{ date: '2026-08-10', value: 5 }, { date: '2026-08-12', value: 9 }])!;
    expect(d.previous).toBe(5);
  });

  it('returns null for empty series', () => {
    expect(metricWeeklyDelta([])).toBeNull();
  });
});

describe('boardPlacements', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('matches entity names against all three board roles, case-insensitively', () => {
    const db = useTestDb();
    db.insert(boardEntries)
      .values({
        domain: 'video',
        task: 'text-to-video',
        bestOverall: 'MiniMax H3 (MiniMax)',
        bestValue: 'Kling 3.0 (KlingAI)',
        cheapestViable: 'Wan 2.7 (Alibaba)',
      })
      .run();
    expect(boardPlacements('minimax h3')).toEqual([{ domain: 'video', task: 'text-to-video', role: 'best overall' }]);
    expect(boardPlacements('Kling')).toEqual([{ domain: 'video', task: 'text-to-video', role: 'best value' }]);
    expect(boardPlacements('nonexistent')).toEqual([]);
  });
});

describe('coMentioned', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('counts shared-story entities with canonical merging, excluding self', () => {
    const db = useTestDb();
    const put = (title: string, entities: { name: string; kind: string }[]) =>
      db.insert(stories).values({ title, status: 'curated', topScore: 70, entities: JSON.stringify(entities), createdAt: new Date() }).run();
    put('a', [{ name: 'GPT-5', kind: 'model' }, { name: 'OpenAI', kind: 'org' }]);
    put('b', [{ name: 'gpt 5', kind: 'model' }, { name: 'OpenAI', kind: 'org' }, { name: 'Sora', kind: 'tool' }]);
    put('c', [{ name: 'Sora', kind: 'tool' }]);
    const out = coMentioned('GPT-5');
    // self excluded; OpenAI in 2 shared stories; Sora in 1
    expect(out.find((e) => e.name === 'GPT-5')).toBeUndefined();
    expect(out[0].name).toBe('OpenAI');
    expect(out[0].count).toBe(2);
    expect(out[0].slug).toBe('openai');
    expect(out[1].name).toBe('Sora');
    expect(out[1].count).toBe(1);
  });
});

describe('humanizeMetricKey', () => {
  it('renders readable labels with display names for known sources', () => {
    expect(humanizeMetricKey('github:owner/repo:stars')).toBe('GitHub stars · owner/repo');
    expect(humanizeMetricKey('npm:react:weekly_downloads')).toBe('npm weekly downloads · react');
    expect(humanizeMetricKey('aa:GPT-5:speed')).toBe('Artificial Analysis speed · GPT-5');
  });
});

import { describe, it, expect } from 'vitest';
import { useTestDb } from './helpers/db';
import { upsertMetric, utcDay } from '@/lib/metrics';
import { paths } from '@/lib/urls';
import {
  hottestLaunchCategory,
  marketMovers,
  resolvePulsePresets,
  risingWatchlist,
} from '@/lib/pulse';

describe('pulse helpers', () => {
  it('hottestLaunchCategory picks the category with the most launches in the window', () => {
    useTestDb();
    const d0 = utcDay(new Date(Date.now() - 3 * 864e5));
    const d1 = utcDay(new Date(Date.now() - 2 * 864e5));
    upsertMetric({ source: 'launches', entity: 'agents', metric: 'count', value: 2, date: d0 });
    upsertMetric({ source: 'launches', entity: 'agents', metric: 'count', value: 3, date: d1 });
    upsertMetric({ source: 'launches', entity: 'ai-coding', metric: 'count', value: 1, date: d0 });
    upsertMetric({ source: 'launches', entity: 'ai-coding', metric: 'count', value: 1, date: d1 });

    const hot = hottestLaunchCategory(7);
    expect(hot).not.toBeNull();
    expect(hot!.category).toBe('agents');
    expect(hot!.total).toBe(5);
  });

  it('marketMovers ranks first-party series by |pct| and excludes aa', () => {
    useTestDb();
    const before = utcDay(new Date(Date.now() - 10 * 864e5));
    const mid = utcDay(new Date(Date.now() - 3 * 864e5));
    upsertMetric({ source: 'github', entity: 'org/repo', metric: 'stars', value: 100, date: before });
    upsertMetric({ source: 'github', entity: 'org/repo', metric: 'stars', value: 150, date: mid });
    upsertMetric({ source: 'aa', entity: 'GPT-5', metric: 'price_blended', value: 10, date: before });
    upsertMetric({ source: 'aa', entity: 'GPT-5', metric: 'price_blended', value: 5, date: mid });

    const since = utcDay(new Date(Date.now() - 7 * 864e5));
    const movers = marketMovers(since, 8);
    expect(movers.every((m) => !m.source.startsWith('aa'))).toBe(true);
    expect(movers[0]).toMatchObject({ source: 'github', entity: 'org/repo', metric: 'stars' });
    expect(movers[0]!.pct).toBeCloseTo(50, 0);
  });

  it('risingWatchlist prefers github/npm/provider-pricing over launches', () => {
    useTestDb();
    const before = utcDay(new Date(Date.now() - 10 * 864e5));
    const mid = utcDay(new Date(Date.now() - 3 * 864e5));
    upsertMetric({ source: 'launches', entity: 'agents', metric: 'count', value: 10, date: before });
    upsertMetric({ source: 'launches', entity: 'agents', metric: 'count', value: 40, date: mid });
    upsertMetric({ source: 'npm', entity: 'openai', metric: 'weekly_downloads', value: 1000, date: before });
    upsertMetric({ source: 'npm', entity: 'openai', metric: 'weekly_downloads', value: 1300, date: mid });

    const list = risingWatchlist(5);
    expect(list.some((m) => m.source === 'npm')).toBe(true);
    expect(list.every((m) => m.source !== 'launches')).toBe(true);
  });

  it('resolvePulsePresets filters missing github/aa entities and gates Frontier on showAA', () => {
    useTestDb();
    upsertMetric({ source: 'github', entity: 'anthropics/claude-code', metric: 'stars', value: 1 });
    upsertMetric({ source: 'github', entity: 'random/other', metric: 'stars', value: 1 });
    upsertMetric({ source: 'aa', entity: 'GPT-5', metric: 'price_blended', value: 10 });

    const signedOut = resolvePulsePresets(false);
    expect(signedOut.map((p) => p.id)).toEqual(['launch-heat', 'coding-agent-stars']);
    const stars = signedOut.find((p) => p.id === 'coding-agent-stars')!;
    expect(stars.keys.map((k) => k.entity)).toEqual(['anthropics/claude-code']);

    const signedIn = resolvePulsePresets(true);
    expect(signedIn.map((p) => p.id)).toContain('frontier-prices');
    const frontier = signedIn.find((p) => p.id === 'frontier-prices')!;
    expect(frontier.keys.map((k) => k.entity)).toEqual(['GPT-5']);
  });

  it('explorer path helper stays on /app/decide/metrics', () => {
    expect(paths.metrics).toBe('/app/decide/metrics');
  });
});

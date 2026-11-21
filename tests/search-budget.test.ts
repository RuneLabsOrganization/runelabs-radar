import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyCap, monthlyCap, reserveSearchCall, searchUsage, SearchBudgetError } from '@/lib/search/budget';
import { bump, gcCounters } from '@/lib/usage/counters';
import { useTestDb } from './helpers/db';

describe('search budget', () => {
  beforeEach(() => {
    useTestDb();
    process.env.EXA_MONTHLY_CALL_CAP = '60'; // → 2/day
  });
  afterEach(() => {
    delete process.env.EXA_MONTHLY_CALL_CAP;
    delete process.env.BRAVE_MONTHLY_CALL_CAP;
  });

  it('derives the daily cap from the monthly cap and has safe defaults', () => {
    expect(monthlyCap('exa')).toBe(60);
    expect(dailyCap('exa')).toBe(2);
    expect(monthlyCap('brave')).toBe(900);
  });

  it('refuses past the daily cap without counting the refused call', () => {
    const t = new Date('2026-11-10T12:00:00Z');
    reserveSearchCall('exa', t);
    reserveSearchCall('exa', t);
    expect(() => reserveSearchCall('exa', t)).toThrow(SearchBudgetError);
    expect(searchUsage('exa', t)).toEqual({ today: 2, month: 2 });
    // next UTC day is a fresh daily window, same month total keeps accumulating
    const t2 = new Date('2026-11-11T00:00:01Z');
    reserveSearchCall('exa', t2);
    expect(searchUsage('exa', t2)).toEqual({ today: 1, month: 3 });
  });

  it('refuses once the monthly cap is spent, then resets next month', () => {
    process.env.BRAVE_MONTHLY_CALL_CAP = '3'; // 1/day
    for (const d of ['01', '02', '03']) reserveSearchCall('brave', new Date(`2026-11-${d}T10:00:00Z`));
    expect(() => reserveSearchCall('brave', new Date('2026-11-04T10:00:00Z'))).toThrow(/monthly/);
    expect(() => reserveSearchCall('brave', new Date('2026-12-01T10:00:00Z'))).not.toThrow();
  });

  it('cap 0 disables a provider; providers are metered independently', () => {
    process.env.BRAVE_MONTHLY_CALL_CAP = '0';
    expect(() => reserveSearchCall('brave')).toThrow(/disabled/);
    expect(() => reserveSearchCall('exa')).not.toThrow();
  });

  it('counter GC keeps the month of search rows it needs', () => {
    const old = new Date('2026-11-01T10:00:00Z');
    reserveSearchCall('exa', old);
    bump('ip:1.1.1.1', 'rate', 'day', old);
    gcCounters(new Date('2026-11-20T10:00:00Z'));
    expect(searchUsage('exa', new Date('2026-11-20T10:00:00Z')).month).toBe(1);
  });
});

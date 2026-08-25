import { beforeEach, describe, expect, it } from 'vitest';
import { bump, peek } from '@/lib/usage/counters';
import { rateLimited, _resetRateLimitForTest } from '../mcp/lib/rate';
import { useTestDb } from './helpers/db';

describe('mcp rate limiting is durable', () => {
  beforeEach(() => {
    useTestDb();
    _resetRateLimitForTest(3);
  });

  it('blocks after the limit and survives a simulated process restart', () => {
    const now = new Date('2026-08-25T10:00:00Z');
    expect(rateLimited('ip:5.5.5.5', now)).toBe(false); // 1
    expect(rateLimited('ip:5.5.5.5', now)).toBe(false); // 2
    expect(rateLimited('ip:5.5.5.5', now)).toBe(false); // 3
    expect(rateLimited('ip:5.5.5.5', now)).toBe(true);  // 4 — over

    // a restart clears module state but NOT the database
    _resetRateLimitForTest(3);
    expect(rateLimited('ip:5.5.5.5', now)).toBe(true);
    expect(peek('ip:5.5.5.5', 'rate', 'hour', now)).toBeGreaterThanOrEqual(4);
  });

  it('lets a different bucket through', () => {
    const now = new Date('2026-08-25T10:00:00Z');
    for (let i = 0; i < 4; i++) rateLimited('ip:5.5.5.5', now);
    expect(rateLimited('ip:6.6.6.6', now)).toBe(false);
  });

  it('resets in the next hour window', () => {
    const t1 = new Date('2026-08-25T10:00:00Z');
    for (let i = 0; i < 4; i++) rateLimited('ip:7.7.7.7', t1);
    expect(rateLimited('ip:7.7.7.7', t1)).toBe(true);

    const t2 = new Date('2026-08-25T11:00:00Z');
    expect(rateLimited('ip:7.7.7.7', t2)).toBe(false);
  });
});

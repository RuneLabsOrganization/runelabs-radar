import { beforeEach, describe, expect, it } from 'vitest';
import { bump, peek, gcCounters } from '@/lib/usage/counters';
import { useTestDb } from './helpers/db';

describe('usage counters', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('counts within a window and resets in the next one', () => {
    const t1 = new Date('2026-08-25T10:15:00Z');
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t1)).toBe(1);
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t1)).toBe(2);
    expect(peek('ip:1.2.3.4', 'rate', 'hour', t1)).toBe(2);

    // same hour, later minute — still the same bucket
    const t2 = new Date('2026-08-25T10:59:59Z');
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t2)).toBe(3);

    // next hour — fresh window
    const t3 = new Date('2026-08-25T11:00:00Z');
    expect(peek('ip:1.2.3.4', 'rate', 'hour', t3)).toBe(0);
    expect(bump('ip:1.2.3.4', 'rate', 'hour', t3)).toBe(1);
  });

  it('isolates buckets and features', () => {
    const t = new Date('2026-08-25T10:00:00Z');
    bump('ip:1.1.1.1', 'rate', 'hour', t);
    bump('ip:1.1.1.1', 'rate', 'hour', t);
    bump('ip:2.2.2.2', 'rate', 'hour', t);
    bump('ip:1.1.1.1', 'scout', 'day', t);

    expect(peek('ip:1.1.1.1', 'rate', 'hour', t)).toBe(2);
    expect(peek('ip:2.2.2.2', 'rate', 'hour', t)).toBe(1);
    expect(peek('ip:1.1.1.1', 'scout', 'day', t)).toBe(1);
  });

  it('uses UTC day boundaries for day windows', () => {
    const late = new Date('2026-08-25T23:30:00Z');
    const early = new Date('2026-08-26T00:30:00Z');
    bump('user:7', 'scout', 'day', late);
    expect(peek('user:7', 'scout', 'day', late)).toBe(1);
    expect(peek('user:7', 'scout', 'day', early)).toBe(0);
  });

  it('gc removes only windows older than the retention cutoff', () => {
    const old = new Date('2026-08-01T10:00:00Z');
    const now = new Date('2026-08-25T10:00:00Z');
    bump('ip:9.9.9.9', 'rate', 'hour', old);
    bump('ip:9.9.9.9', 'rate', 'hour', now);

    const removed = gcCounters(now);
    expect(removed).toBe(1);
    expect(peek('ip:9.9.9.9', 'rate', 'hour', now)).toBe(1);
  });
});

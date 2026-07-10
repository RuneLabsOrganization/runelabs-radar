import { describe, it, expect } from 'vitest';
import { visitAnchor, VISIT_GAP_MS } from '@/lib/visits';

const T0 = new Date('2026-07-10T12:00:00Z').getTime();
const min = (n: number) => n * 60 * 1000;

describe('visitAnchor', () => {
  it('is null for a first-ever visit', () => {
    expect(visitAnchor({ lastSeenAt: null, prevSeenAt: null }, T0)).toBeNull();
  });

  it('uses lastSeenAt when the last request is older than the visit gap (new visit)', () => {
    const lastSeenAt = new Date(T0 - VISIT_GAP_MS - min(1));
    expect(visitAnchor({ lastSeenAt, prevSeenAt: new Date(T0 - min(600)) }, T0)).toEqual(lastSeenAt);
  });

  it('uses prevSeenAt during an active visit so the divider stays put across refreshes', () => {
    const prevSeenAt = new Date(T0 - min(600)); // previous visit, 10h ago
    const lastSeenAt = new Date(T0 - min(1)); // heartbeat from this visit
    expect(visitAnchor({ lastSeenAt, prevSeenAt }, T0)).toEqual(prevSeenAt);
  });

  it('falls back to lastSeenAt during an active visit when prevSeenAt is missing', () => {
    const lastSeenAt = new Date(T0 - min(2));
    expect(visitAnchor({ lastSeenAt, prevSeenAt: null }, T0)).toEqual(lastSeenAt);
  });
});

import { describe, expect, it } from 'vitest';
import { parseConsent, serializeConsent } from '@/lib/consent';

describe('consent', () => {
  it('round-trips', () => {
    const raw = serializeConsent({ analytics: true, errors: false });
    expect(parseConsent(raw)).toEqual({ analytics: true, errors: false });
  });
  it('returns null for missing or garbage', () => {
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent('')).toBeNull();
    expect(parseConsent('not-json')).toBeNull();
    expect(parseConsent('{"analytics":1}')).toBeNull();
  });
});

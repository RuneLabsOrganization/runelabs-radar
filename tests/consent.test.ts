import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_COOKIE, parseConsent, readConsent, serializeConsent } from '@/lib/consent';

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

describe('readConsent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the consent cookie among other cookies', () => {
    const value = encodeURIComponent(serializeConsent({ analytics: true, errors: false }));
    vi.stubGlobal('document', { cookie: `other=1; ${CONSENT_COOKIE}=${value}; theme=dark` });
    expect(readConsent()).toEqual({ analytics: true, errors: false });
  });

  it('returns null when the cookie is missing or malformed', () => {
    vi.stubGlobal('document', { cookie: 'other=1' });
    expect(readConsent()).toBeNull();
    vi.stubGlobal('document', { cookie: `${CONSENT_COOKIE}=garbage` });
    expect(readConsent()).toBeNull();
    vi.stubGlobal('document', { cookie: `${CONSENT_COOKIE}=${encodeURIComponent('{"analytics":1}')}` });
    expect(readConsent()).toBeNull();
  });

  it('returns null off-DOM (SSR / node)', () => {
    expect(readConsent()).toBeNull();
  });
});

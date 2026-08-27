import { describe, expect, it } from 'vitest';
import { landingJsonLd, siteMeta } from '@/lib/seo';

describe('siteMeta', () => {
  it('sets canonical from path', () => {
    const m = siteMeta('Pricing', 'desc', '/pricing');
    expect(m.alternates?.canonical).toMatch(/\/pricing$/);
    expect(m.openGraph?.title).toBe('Pricing');
  });
  it('noindexes when index is false', () => {
    const m = siteMeta('Sign in', 'desc', '/login', { index: false });
    expect(m.robots).toEqual({ index: false, follow: false });
  });
});

describe('landingJsonLd', () => {
  it('emits Organization, SoftwareApplication, FAQPage', () => {
    const types = landingJsonLd().map((x) => x['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'FAQPage']));
  });
});

import { describe, expect, it } from 'vitest';
import { gradeConfidence } from '@/lib/kits/confidence';
import { independence, registrableDomain } from '@/lib/kits/provenance';

describe('registrableDomain', () => {
  it('strips protocol, path and www', () => {
    expect(registrableDomain('https://www.anthropic.com/news/x')).toBe('anthropic.com');
  });

  it('collapses subdomains to the registrable domain', () => {
    expect(registrableDomain('https://blog.eng.openai.com/post')).toBe('openai.com');
  });

  it('handles multi-part public suffixes', () => {
    expect(registrableDomain('https://foo.bar.co.uk/x')).toBe('bar.co.uk');
    expect(registrableDomain('https://someproject.github.io/docs')).toBe('someproject.github.io');
  });

  it('returns null for a non-http url', () => {
    expect(registrableDomain('javascript:alert(1)')).toBeNull();
  });
});

describe('independence', () => {
  it('counts one domain once no matter how many urls', () => {
    const r = independence([
      { sourceUrl: 'https://openai.com/a', role: 'first_party' },
      { sourceUrl: 'https://openai.com/b', role: 'first_party' },
      { sourceUrl: 'https://blog.openai.com/c', role: 'first_party' },
    ]);
    expect(r.distinctDomains).toBe(1);
    expect(r.independentDomains).toBe(0);
  });

  it('counts only independent-role domains as independent', () => {
    const r = independence([
      { sourceUrl: 'https://openai.com/a', role: 'first_party' },
      { sourceUrl: 'https://artificialanalysis.ai/x', role: 'independent' },
      { sourceUrl: 'https://reddit.com/r/x', role: 'community' },
    ]);
    expect(r.distinctDomains).toBe(3);
    expect(r.independentDomains).toBe(1);
  });

  it('ignores unparseable urls', () => {
    const r = independence([{ sourceUrl: 'not-a-url', role: 'independent' }]);
    expect(r.distinctDomains).toBe(0);
    expect(r.independentDomains).toBe(0);
  });
});

describe('gradeConfidence independence gate', () => {
  const fresh = { evidenceCount: 30, distinctSources: 5, verifiedAt: new Date(), now: new Date() };

  it('allows high when independent evidence exists', () => {
    expect(gradeConfidence({ ...fresh, independentDomains: 2 })).toBe('high');
  });

  it('caps at low when every source is first-party or community', () => {
    expect(gradeConfidence({ ...fresh, independentDomains: 0 })).toBe('low');
  });

  it('defaults to the old behaviour when independence is not supplied', () => {
    expect(gradeConfidence(fresh)).toBe('high');
  });
});

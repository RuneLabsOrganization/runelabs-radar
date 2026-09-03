import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';

describe('robots.txt', () => {
  it('disallows the admin console where it actually lives (/app/admin)', () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const disallowed = rules.flatMap((rule) => {
      const d = rule?.disallow ?? [];
      return Array.isArray(d) ? d : [d];
    });
    expect(disallowed).toContain('/app/admin');
    // bare /admin is only the 301 to the console — disallowing it protects nothing
    expect(disallowed).not.toContain('/admin');
    expect(disallowed).toContain('/api/');
  });
});

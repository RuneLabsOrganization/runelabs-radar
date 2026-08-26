import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/app/app/connect/page.tsx', import.meta.url), 'utf8');

describe('connect page catalogs the generation ladder', () => {
  it('lists the four ladder tools under Ideas', () => {
    expect(src).toContain('get_leads');
    expect(src).toContain('refine_lead');
    expect(src).toContain('forge_opportunity');
    expect(src).toContain('dismiss_opportunity');
  });

  it('lists the explore_unlimited prompt', () => {
    expect(src).toContain('explore_unlimited');
  });
});

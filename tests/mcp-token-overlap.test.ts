import { describe, expect, it } from 'vitest';
import { overlap, tokenSet } from '../mcp/lib/overlap';

// G5: the token-overlap helpers were copied verbatim between mcp/tools/debate.ts
// and mcp/tools/jobs.ts; they now live in mcp/lib/overlap.ts. Pin the scoring
// rule here so the two call sites can never drift apart again.
describe('tokenSet', () => {
  it('drops stopwords and tokens of length ≤ 2, lowercases the rest', () => {
    expect(tokenSet('The AI tool for SaaS platform idea')).toEqual(new Set());
    expect(tokenSet('Kubernetes Operators 42x')).toEqual(new Set(['kubernetes', 'operators', '42x']));
  });

  it('splits on non-alphanumeric runs', () => {
    expect(tokenSet('vector DBs, self-hosted!')).toEqual(new Set(['vector', 'dbs', 'self', 'hosted']));
  });
});

describe('overlap', () => {
  it('is 1 for identical non-empty sets and 0 for disjoint sets', () => {
    const a = tokenSet('vector database hosting');
    expect(overlap(a, a)).toBe(1);
    expect(overlap(a, tokenSet('banana bread'))).toBe(0);
  });

  it('is 0 when either side is empty', () => {
    expect(overlap(new Set(), tokenSet('vector database'))).toBe(0);
    expect(overlap(tokenSet('vector database'), new Set())).toBe(0);
  });

  it('normalizes as |a∩b| / sqrt(|a|·|b|)', () => {
    const a = new Set(['alpha', 'beta', 'gamma', 'delta']);
    const b = new Set(['alpha', 'beta']);
    expect(overlap(a, b)).toBeCloseTo(2 / Math.sqrt(8));
    // symmetric
    expect(overlap(b, a)).toBeCloseTo(2 / Math.sqrt(8));
  });
});

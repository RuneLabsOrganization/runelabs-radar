import { describe, it, expect } from 'vitest';
import { sanitizeEvidence } from '@/lib/kits/evidence';

const ITEMS = [{ url: 'https://a.example/1' }, { url: 'https://b.example/2' }];

describe('sanitizeEvidence', () => {
  it('keeps a well-formed draft and attaches the item url', () => {
    const out = sanitizeEvidence(
      [{ category: 'video', task: 'text-to-video', toolName: 'Kling 3.0', sentiment: 1, excerpt: 'held motion well', itemIndex: 0 }],
      ITEMS.length,
      ITEMS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrl).toBe('https://a.example/1');
    expect(out[0].sentiment).toBe(1);
  });

  it('drops a draft whose cell is not in the grid', () => {
    const out = sanitizeEvidence(
      [{ category: 'video', task: 'not-real', toolName: 'X', sentiment: 1, excerpt: 'x', itemIndex: 0 }],
      ITEMS.length,
      ITEMS,
    );
    expect(out).toHaveLength(0);
  });

  it('drops an out-of-range item index rather than trusting the model', () => {
    const out = sanitizeEvidence(
      [{ category: 'video', task: 'text-to-video', toolName: 'X', sentiment: 1, excerpt: 'x', itemIndex: 99 }],
      ITEMS.length,
      ITEMS,
    );
    expect(out).toHaveLength(0);
  });

  it('coerces an invalid sentiment to neutral', () => {
    const out = sanitizeEvidence(
      [{ category: 'video', task: 'text-to-video', toolName: 'X', sentiment: 7, excerpt: 'x', itemIndex: 0 }],
      ITEMS.length,
      ITEMS,
    );
    expect(out[0].sentiment).toBe(0);
  });

  it('ignores non-array and malformed input', () => {
    expect(sanitizeEvidence(null, 2, ITEMS)).toEqual([]);
    expect(sanitizeEvidence([null, 'x', 42], 2, ITEMS)).toEqual([]);
  });
});

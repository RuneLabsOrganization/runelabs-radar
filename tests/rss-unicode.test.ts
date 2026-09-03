import { describe, expect, it } from 'vitest';
import { mdToText } from '@/lib/rss';

/** Matches any lone surrogate half (what a UTF-16 unit slice leaves behind). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('mdToText surrogate-safe truncation (E2)', () => {
  it('does not sever a surrogate pair when an emoji sits at the cut boundary', () => {
    // 298 ascii chars + 🚀 (2 UTF-16 units) + tail: a UTF-16 slice at 299
    // would keep the rocket's high surrogate and drop its low half
    const md = `${'a'.repeat(298)}🚀 tail`;
    const out = mdToText(md, 300);
    expect(out).not.toMatch(LONE_SURROGATE);
    expect(out).not.toContain('\uFFFD');
    expect(out).toBe(`${'a'.repeat(298)}🚀…`);
  });

  it('keeps whole emoji when the boundary falls just before one', () => {
    const md = `${'x'.repeat(299)}🚀 more text here`;
    const out = mdToText(md, 300);
    expect(out).not.toMatch(LONE_SURROGATE);
    expect(out.endsWith('…')).toBe(true);
  });

  it('still truncates plain ascii to the cap', () => {
    const out = mdToText('word '.repeat(200), 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('counts code points, so astral text is not cut early', () => {
    // 200 emoji = 400 UTF-16 units but 200 code points → under the default 300 cap
    const md = '🚀'.repeat(200);
    const out = mdToText(md);
    expect(out).toBe(md);
    expect(out).not.toMatch(LONE_SURROGATE);
  });
});

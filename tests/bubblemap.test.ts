import { describe, expect, it } from 'vitest';
import { fitLabel } from '@/components/BubbleMap';

describe('fitLabel', () => {
  it('returns short labels as a single line', () => {
    expect(fitLabel('Coding agents', 120, 13)).toEqual(['Coding agents']);
  });

  it('wraps long labels to at most two lines within the chord', () => {
    const r = 80;
    const fontSize = 12;
    const lines = fitLabel('Abstract experimental short films', r, fontSize)!;
    expect(lines.length).toBeLessThanOrEqual(2);
    const maxChars = Math.floor((r * 1.5) / (fontSize * 0.62));
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(maxChars);
  });

  it('ellipsizes when two lines are not enough', () => {
    const lines = fitLabel('A very long cluster name that cannot possibly fit inside a small circle', 45, 11)!;
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });

  it('returns null when the circle is too small for text', () => {
    expect(fitLabel('anything', 20, 12)).toBeNull();
    expect(fitLabel('anything', 29, 12)).toBeNull();
  });

  it('never mid-word truncates when a word fits on its own line', () => {
    const lines = fitLabel('Mythology folklore', 70, 12)!;
    expect(lines).toEqual(['Mythology', 'folklore']);
  });
});

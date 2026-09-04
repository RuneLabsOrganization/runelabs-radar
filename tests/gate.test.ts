import { describe, expect, it } from 'vitest';
import { passesGate } from '@/lib/curate/gate';

describe('passesGate', () => {
  it('a single strong term passes anywhere', () => {
    expect(passesGate('Celebrity adopts puppy')).toBe(false);
    expect(passesGate('OpenAI launches something')).toBe(true);
    expect(passesGate('Celebrity news', ['meanwhile Claude shipped a thing'])).toBe(true);
  });

  it('a single phrase tripping two weak regexes does NOT pass (E10)', () => {
    // "AI model" trips /\bai\b/ AND /\bmodel(s)?\b/ — one piece of evidence,
    // two regex hits; the old count-regexes rule let this through
    expect(passesGate('New AI model')).toBe(false);
  });

  it('the SAME text in two fields is still one location (E10)', () => {
    // the story title and its first member item usually share a title —
    // that duplication must not count as distributed evidence
    expect(passesGate('New AI model', ['New AI model'])).toBe(false);
    expect(passesGate('New AI model', ['New AI model', ''])).toBe(false);
  });

  it('weak evidence in two distinct locations passes (E10)', () => {
    expect(passesGate('New AI model', ['Benchmark results inside'])).toBe(true);
    expect(passesGate('New AI model', ['celebrity gossip', 'workflow tips for teams'])).toBe(true);
  });

  it('two weak terms in ONE location still do not pass (E10)', () => {
    expect(passesGate('AI model benchmark')).toBe(false);
    expect(passesGate('AI model benchmark', ['celebrity gossip roundup'])).toBe(false);
  });
});

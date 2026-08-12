import { describe, expect, it } from 'vitest';
import { decodeEntities, stripHtml, textOf } from '@/lib/ingest/adapters/shared';

describe('decodeEntities', () => {
  it('decodes decimal numeric entities', () => {
    expect(decodeEntities('Rideshare Stimulator&#8217;s writers')).toBe('Rideshare Stimulator’s writers');
    expect(decodeEntities('GPT&#8211;5')).toBe('GPT–5');
  });

  it('decodes hex numeric entities', () => {
    expect(decodeEntities('it&#x2019;s here')).toBe('it’s here');
    expect(decodeEntities('&#x1F680;')).toBe('🚀');
  });

  it('decodes the common named set', () => {
    expect(decodeEntities('A &amp; B &lt;tag&gt; &quot;quoted&quot; &mdash; fine&hellip;')).toBe(
      'A & B <tag> "quoted" — fine…',
    );
  });

  it('leaves unknown entities and lone ampersands untouched', () => {
    expect(decodeEntities('a & b &bogus; c')).toBe('a & b &bogus; c');
  });

  it('leaves malformed numerics untouched', () => {
    expect(decodeEntities('&#xZZ; &#;')).toBe('&#xZZ; &#;');
  });
});

describe('textOf', () => {
  it('decodes entities in feed titles', () => {
    expect(textOf('Saber denies replacing writers &#8212; ChatGPT')).toBe('Saber denies replacing writers — ChatGPT');
  });
});

describe('stripHtml', () => {
  it('strips tags and decodes numeric entities', () => {
    expect(stripHtml('<p>Tom &amp; Zendaya&#8217;s <b>wedding</b></p>')).toBe('Tom & Zendaya’s wedding');
  });
});

import { describe, expect, it } from 'vitest';
import { promptLine, stripCjkDeep, stripCjkLeak } from '@/lib/prompt-hygiene';

describe('stripCjkLeak', () => {
  it('removes leaked hanzi from English text', () => {
    expect(stripCjkLeak('Deploy the 这些 files to Vercel')).toBe('Deploy the files to Vercel');
    expect(stripCjkLeak('check the 检索 results')).toBe('check the results');
  });

  it('removes kana and maps CJK punctuation to ASCII', () => {
    expect(stripCjkLeak('run the 検索 query')).toBe('run the query');
    expect(stripCjkLeak('first step。then this、then that')).toBe('first step. then this, then that');
  });

  it('normalizes fullwidth ASCII to ASCII', () => {
    expect(stripCjkLeak('price：$29／mo')).toBe('price:$29/mo');
    expect(stripCjkLeak('it works！')).toBe('it works!');
  });

  it('leaves ordinary English untouched (no warning path)', () => {
    const s = 'A perfectly normal English sentence — with an em-dash, “quotes”, and €25.';
    expect(stripCjkLeak(s)).toBe(s);
  });

  it('preserves markdown newlines while collapsing spaces', () => {
    const out = stripCjkLeak('## Title 标题\n\n- item one\n- item 二 two');
    expect(out).toContain('\n\n');
    expect(out).toContain('## Title');
    expect(out).toContain('- item two');
  });

  it('collapses double space left by a mid-sentence strip', () => {
    expect(stripCjkLeak('build 反复 the loop')).toBe('build the loop');
  });
});

describe('stripCjkDeep', () => {
  it('walks nested structures and arrays', () => {
    const out = stripCjkDeep({
      title: 'Plan 计划',
      tasks: [{ detail: 'do the 反复 thing', n: 3 }],
      nested: { note: 'clean' },
    });
    expect(out.title).toBe('Plan');
    expect(out.tasks[0]!.detail).toBe('do the thing');
    expect(out.tasks[0]!.n).toBe(3);
    expect(out.nested.note).toBe('clean');
  });
});

describe('promptLine (input side) is NOT CJK-stripped', () => {
  it('keeps legitimate CJK content in scraped input', () => {
    expect(promptLine('小米 launches a model')).toContain('小米');
  });
});

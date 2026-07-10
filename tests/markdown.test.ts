import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';

describe('renderMarkdown', () => {
  it('escapes all raw HTML (no passthrough)', () => {
    const out = renderMarkdown('<script>alert("x")</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&quot;');
  });

  it('renders #/##/### headings', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('## Sub')).toBe('<h2>Sub</h2>');
    expect(renderMarkdown('### Deep')).toBe('<h3>Deep</h3>');
  });

  it('does not treat #### as a heading', () => {
    expect(renderMarkdown('#### nope')).toBe('<p>#### nope</p>');
  });

  it('renders bold and italic', () => {
    const out = renderMarkdown('**bold** and *ital*');
    expect(out).toBe('<p><strong>bold</strong> and <em>ital</em></p>');
  });

  it('renders inline code with escaped contents, protected from other formatting', () => {
    expect(renderMarkdown('use `a < b` here')).toBe('<p>use <code>a &lt; b</code> here</p>');
    expect(renderMarkdown('`**not bold**`')).toBe('<p><code>**not bold**</code></p>');
  });

  it('does not corrupt digits or text around code spans', () => {
    const out = renderMarkdown('run 42 tests with `npm test` and 7 more');
    expect(out).toBe('<p>run 42 tests with <code>npm test</code> and 7 more</p>');
  });

  it('renders "- " lists', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders http(s) links with target=_blank', () => {
    const out = renderMarkdown('[site](https://example.com/a?b=1)');
    expect(out).toBe(
      '<p><a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">site</a></p>',
    );
  });

  it('refuses non-http link schemes', () => {
    const out = renderMarkdown('[x](javascript:alert(1))');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('href');
    expect(out).toBe('<p>[x](javascript:alert(1))</p>');
  });

  it('joins consecutive lines into one paragraph and splits on blank lines', () => {
    const out = renderMarkdown('line one\nline two\n\nsecond para');
    expect(out).toBe('<p>line one line two</p>\n<p>second para</p>');
  });

  it('handles a realistic brief document', () => {
    const md = [
      '# Daily Brief — 2026-07-10',
      '',
      '## Top stories',
      '- **GPT-6 shipped** — see [announcement](https://openai.com/gpt6)',
      '- Runway *Gen-5* preview',
      '',
      '### Board changes',
      'bestOverall: `GPT-5.2` → `Claude Fable 5`',
    ].join('\n');
    const out = renderMarkdown(md);
    expect(out).toContain('<h1>Daily Brief — 2026-07-10</h1>');
    expect(out).toContain('<h2>Top stories</h2>');
    expect(out).toContain('<strong>GPT-6 shipped</strong>');
    expect(out).toContain('<em>Gen-5</em>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('<h3>Board changes</h3>');
    expect(out).toContain('<code>Claude Fable 5</code>');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('\n\n')).toBe('');
  });
});

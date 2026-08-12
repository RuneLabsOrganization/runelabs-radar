import { describe, expect, it } from 'vitest';
import { buildRss, escapeXml, mdToText } from '@/lib/rss';

describe('rss feed builder', () => {
  it('escapes XML special chars in all fields', () => {
    const xml = buildRss({
      title: 'A & B <test>',
      link: 'https://x.test/?a=1&b=2',
      description: 'quotes "here" and \'there\'',
      items: [
        {
          title: '5 > 3 & 2 < 4',
          link: 'https://x.test/story/1',
          date: new Date('2026-08-12T08:00:00Z'),
          description: 'tldr with <tags>',
        },
      ],
    });
    expect(xml).toContain('A &amp; B &lt;test&gt;');
    expect(xml).toContain('https://x.test/?a=1&amp;b=2');
    expect(xml).toContain('5 &gt; 3 &amp; 2 &lt; 4');
    expect(xml).toContain('tldr with &lt;tags&gt;');
    expect(xml).not.toContain('<tags>');
  });

  it('emits a well-formed rss 2.0 skeleton with pubDate and guid', () => {
    const xml = buildRss({
      title: 't',
      link: 'https://x.test',
      description: 'd',
      items: [{ title: 'i', link: 'https://x.test/1', date: new Date('2026-08-12T08:00:00Z') }],
    });
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('</channel>\n</rss>');
    expect(xml).toContain('<pubDate>Wed, 12 Aug 2026 08:00:00 GMT</pubDate>');
    expect(xml).toContain('<guid isPermaLink="true">https://x.test/1</guid>');
  });

  it('uses explicit guids as non-permalinks', () => {
    const xml = buildRss({
      title: 't',
      link: 'https://x.test',
      description: 'd',
      items: [{ title: 'i', link: 'https://x.test/1', date: new Date(), guid: 'brief-2026-08-12' }],
    });
    expect(xml).toContain('<guid isPermaLink="false">brief-2026-08-12</guid>');
  });

  it('renders empty feeds without items', () => {
    const xml = buildRss({ title: 't', link: 'https://x.test', description: 'd', items: [] });
    expect(xml).toContain('<channel>');
    expect(xml).not.toContain('<item>');
  });
});

describe('mdToText', () => {
  it('strips markdown syntax to plain text', () => {
    expect(mdToText('# Title\n\n**Bold** and *italic* with `code` and [a link](https://x.test).\n\n- bullet'))
      .toBe('Title Bold and italic with code and a link. bullet');
  });

  it('truncates long text with an ellipsis', () => {
    const out = mdToText('word '.repeat(200), 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

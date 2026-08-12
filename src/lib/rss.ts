/**
 * Minimal RSS 2.0 feed builder — no deps, everything XML-escaped.
 * Used by /changelog.xml and /brief.xml route handlers.
 */

export interface RssItem {
  title: string;
  link: string;
  date: Date;
  description?: string;
  /** Stable id; defaults to link. */
  guid?: string;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Rough plain-text rendering of brief markdown for RSS descriptions. */
export function mdToText(md: string, max = 300): string {
  const text = md
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1') // links → label
    .replace(/[*_`#]/g, '') // emphasis/heading markers
    .replace(/^-\s+/gm, '') // list bullets
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function buildRss(opts: {
  title: string;
  link: string;
  description: string;
  items: RssItem[];
}): string {
  const items = opts.items
    .map(
      (it) =>
        '  <item>\n' +
        `    <title>${escapeXml(it.title)}</title>\n` +
        `    <link>${escapeXml(it.link)}</link>\n` +
        `    <guid isPermaLink="${it.guid ? 'false' : 'true'}">${escapeXml(it.guid ?? it.link)}</guid>\n` +
        `    <pubDate>${it.date.toUTCString()}</pubDate>\n` +
        (it.description ? `    <description>${escapeXml(it.description)}</description>\n` : '') +
        '  </item>',
    )
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0">\n' +
    '<channel>\n' +
    `  <title>${escapeXml(opts.title)}</title>\n` +
    `  <link>${escapeXml(opts.link)}</link>\n` +
    `  <description>${escapeXml(opts.description)}</description>\n` +
    `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
    `${items}\n` +
    '</channel>\n' +
    '</rss>\n'
  );
}

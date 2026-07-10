import type { FetchedItem, Source, SourceAdapter } from '../types';
import { fetchText, parseConfig, toExcerpt } from './shared';

interface GithubConfig {
  language?: string;
}

/**
 * Best-effort scrape of GitHub trending. Article blocks look like:
 *   <article class="Box-row"><h2 class="h3 lh-condensed"><a href="/owner/repo">…</a></h2>
 *   <p class="col-9 …">description</p> …</article>
 */
export function parseTrending(html: string): FetchedItem[] {
  const out: FetchedItem[] = [];
  const blocks = html.split(/<article\b/i).slice(1);
  for (const block of blocks) {
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
    if (!h2) continue;
    const repoLink = /href="\/([^"/?#]+)\/([^"/?#]+)"/.exec(h2[1]);
    if (!repoLink) continue;
    const [, owner, repo] = repoLink;
    // Description is the first <p> after the heading, within this article block.
    const rest = block.slice(h2.index + h2[0].length);
    const desc = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(rest);
    out.push({
      url: `https://github.com/${owner}/${repo}`,
      title: `${owner}/${repo}`,
      excerpt: desc ? toExcerpt(desc[1]) : null,
      publishedAt: null, // trending page has no publish timestamps
    });
  }
  return out;
}

export const githubAdapter: SourceAdapter = {
  type: 'github',
  async fetchItems(source: Source): Promise<FetchedItem[]> {
    // Scraping is best-effort: any fetch or parse failure returns [] and never
    // throws past the adapter (the trending page layout can change under us).
    try {
      const cfg = parseConfig<GithubConfig>(source.config);
      const lang = cfg.language ? `/${encodeURIComponent(cfg.language)}` : '';
      const html = await fetchText(`https://github.com/trending${lang}?since=daily`);
      return parseTrending(html);
    } catch (e) {
      console.error(
        `[ingest] github trending scrape failed for "${source.name}":`,
        e instanceof Error ? e.message : e,
      );
      return [];
    }
  },
};

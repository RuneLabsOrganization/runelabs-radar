import { describe, expect, it } from 'vitest';
import { parseGithubRepo, rankRepos, SERIES_SEMANTICS } from '@/lib/velocity';

function sighting(repo: string, daysAgo: number): { url: string; fetchedAt: Date } {
  return { url: `https://github.com/${repo}`, fetchedAt: new Date(Date.now() - daysAgo * 864e5) };
}

describe('rankRepos (E11)', () => {
  it('keeps hot repos under the cap instead of slicing DB-row order', () => {
    // 41 distinct repos; 'hot/repo' appears LAST in row order but has the most
    // sightings — the old .slice(0, 40) would have dropped it silently
    const rows = Array.from({ length: 40 }, (_, i) => sighting(`filler/repo${i}`, 0));
    rows.push(sighting('hot/repo', 6), sighting('hot/repo', 3), sighting('hot/repo', 1));

    const ranked = rankRepos(rows, 40);
    expect(ranked).toHaveLength(40);
    expect(ranked[0]).toBe('hot/repo');
    // one filler dropped — the one with the OLDEST... all same age, so any one;
    // what matters: the hot repo survived the cap
    expect(ranked).toContain('hot/repo');
  });

  it('breaks sighting ties by most recent sighting', () => {
    const rows = [sighting('a/old', 5), sighting('b/recent', 0)];
    expect(rankRepos(rows)).toEqual(['b/recent', 'a/old']);
  });

  it('dedups repos across urls and ignores non-github urls', () => {
    const rows = [
      { url: 'https://github.com/a/b/issues/1', fetchedAt: new Date() },
      { url: 'https://github.com/a/b', fetchedAt: new Date() },
      { url: 'https://example.com/not-github', fetchedAt: new Date() },
    ];
    expect(rankRepos(rows)).toEqual(['a/b']);
  });
});

describe('series semantics registry (E11)', () => {
  it('records cumulative vs rolling-rate kinds for consumers of metric_points', () => {
    // npm weekly_downloads is a rolling 7d rate: consecutive points overlap 6
    // days, so endpoint %-moves understate growth ~7× — compare windowed means
    expect(SERIES_SEMANTICS['npm:weekly_downloads']).toBe('rolling-7d-rate');
    expect(SERIES_SEMANTICS['github:stars']).toBe('cumulative');
    expect(SERIES_SEMANTICS['huggingface:downloads']).toBe('cumulative');
  });
});

describe('parseGithubRepo', () => {
  it('parses owner/repo and rejects non-github urls', () => {
    expect(parseGithubRepo('https://github.com/owner/repo')).toBe('owner/repo');
    expect(parseGithubRepo('https://github.com/owner/repo/tree/main')).toBe('owner/repo');
    expect(parseGithubRepo('https://gitlab.com/owner/repo')).toBeNull();
  });
});

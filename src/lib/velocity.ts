import { and, eq, gte, inArray } from 'drizzle-orm';
import { config } from './config';
import { getDb } from './db';
import { items, sources } from './db/schema';
import { fetchJson } from './ingest/adapters/shared';
import { upsertMetric } from './metrics';

const REPO_CAP = 40;
const HF_LIMIT = 30;

/**
 * Per-series semantics — every consumer of metric_points must know these
 * (the schema has no `kind` column, so this registry + the comments at the
 * writes are the record):
 * - github.stars / github.forks: CUMULATIVE all-time counters. Growth = delta
 *   between points; endpoint %-moves are meaningless.
 * - huggingface.downloads / .likes: CUMULATIVE all-time counters (same math).
 * - npm.weekly_downloads: ROLLING 7-day RATE, re-measured daily. Consecutive
 *   points overlap by 6 days, so day-over-day %-moves double-count and
 *   understate true growth ~7×; compare windows by their MEAN, not endpoints.
 */
export const SERIES_SEMANTICS = {
  'github:stars': 'cumulative',
  'github:forks': 'cumulative',
  'huggingface:downloads': 'cumulative',
  'huggingface:likes': 'cumulative',
  'npm:weekly_downloads': 'rolling-7d-rate',
} as const;

/** npm packages whose adoption tracks the AI-dev ecosystem Runelabs builds on. */
export const NPM_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  'ai',
  '@google/genai',
  'langchain',
  '@modelcontextprotocol/sdk',
  'ollama',
  '@huggingface/transformers',
];

/** "https://github.com/owner/repo[/…]" → "owner/repo"; anything else → null. Exported for tests. */
export function parseGithubRepo(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const [owner, repo] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

interface GhRepo {
  stargazers_count?: number;
  forks_count?: number;
}

interface HfModel {
  id?: string;
  downloads?: number;
  likes?: number;
}

interface NpmPoint {
  downloads?: number;
}

/**
 * Rank trending-surfaced repos for the tracking cap: most sightings this week
 * first (a repo the trending source keeps resurfacing is hot), most recent
 * sighting as tiebreak. Slicing the deduped set in DB-row order — what this
 * replaced — silently dropped hot repos on busy weeks and gap-corrupted their
 * star series. Exported for tests.
 */
export function rankRepos(rows: { url: string; fetchedAt: Date }[], cap = REPO_CAP): string[] {
  const seen = new Map<string, { sightings: number; last: number }>();
  for (const r of rows) {
    const repo = parseGithubRepo(r.url);
    if (!repo) continue;
    const e = seen.get(repo) ?? { sightings: 0, last: 0 };
    e.sightings += 1;
    e.last = Math.max(e.last, r.fetchedAt.getTime());
    seen.set(repo, e);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].sightings - a[1].sightings || b[1].last - a[1].last)
    .slice(0, cap)
    .map(([repo]) => repo);
}

/**
 * Daily adoption-velocity sweep: GitHub stars for the repos our trending
 * source surfaced this week, HuggingFace download leaders, npm weekly
 * downloads for the AI SDK set. Each group is best-effort.
 * Series semantics differ per group — see SERIES_SEMANTICS before charting
 * or computing moves.
 */
export async function runVelocity(): Promise<{ repos: number; hf: number; npm: number; failed: number }> {
  const db = getDb();
  let failed = 0;

  // GitHub: repos seen in the trending source over the last 7 days
  const rows = db
    .select({ url: items.url, fetchedAt: items.fetchedAt })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(and(eq(sources.type, 'github'), gte(items.fetchedAt, new Date(Date.now() - 7 * 864e5))))
    .all();
  const repos = rankRepos(rows);
  let repoCount = 0;
  for (const repo of repos) {
    try {
      const data = await fetchJson<GhRepo>(`https://api.github.com/repos/${repo}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'runelabs-radar',
          ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
        },
      });
      if (typeof data.stargazers_count === 'number') {
        upsertMetric({ source: 'github', entity: repo, metric: 'stars', value: data.stargazers_count });
        repoCount++;
      }
      if (typeof data.forks_count === 'number') {
        upsertMetric({ source: 'github', entity: repo, metric: 'forks', value: data.forks_count });
      }
    } catch {
      failed++;
    }
  }

  // HuggingFace download leaders
  let hfCount = 0;
  try {
    const models = await fetchJson<HfModel[]>(
      `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${HF_LIMIT}`,
    );
    for (const m of models) {
      if (typeof m.id !== 'string') continue;
      if (typeof m.downloads === 'number') {
        upsertMetric({ source: 'huggingface', entity: m.id, metric: 'downloads', value: m.downloads });
        hfCount++;
      }
      if (typeof m.likes === 'number') {
        upsertMetric({ source: 'huggingface', entity: m.id, metric: 'likes', value: m.likes });
      }
    }
  } catch (e) {
    console.error('[velocity] huggingface fetch failed:', e);
    failed++;
  }

  // npm weekly downloads
  let npmCount = 0;
  for (const pkg of NPM_PACKAGES) {
    try {
      const data = await fetchJson<NpmPoint>(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`,
      );
      if (typeof data.downloads === 'number') {
        upsertMetric({ source: 'npm', entity: pkg, metric: 'weekly_downloads', value: data.downloads });
        npmCount++;
      }
    } catch {
      failed++;
    }
  }

  return { repos: repoCount, hf: hfCount, npm: npmCount, failed };
}

import { and, eq, gte, inArray } from 'drizzle-orm';
import { config } from './config';
import { getDb } from './db';
import { items, sources } from './db/schema';
import { fetchJson } from './ingest/adapters/shared';
import { upsertMetric } from './metrics';

const REPO_CAP = 40;
const HF_LIMIT = 30;

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
 * Daily adoption-velocity sweep: GitHub stars for the repos our trending
 * source surfaced this week, HuggingFace download leaders, npm weekly
 * downloads for the AI SDK set. Each group is best-effort.
 */
export async function runVelocity(): Promise<{ repos: number; hf: number; npm: number; failed: number }> {
  const db = getDb();
  let failed = 0;

  // GitHub: repos seen in the trending source over the last 7 days
  const rows = db
    .select({ url: items.url })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(and(eq(sources.type, 'github'), gte(items.fetchedAt, new Date(Date.now() - 7 * 864e5))))
    .all();
  const repos = [...new Set(rows.map((r) => parseGithubRepo(r.url)).filter((r): r is string => r !== null))].slice(
    0,
    REPO_CAP,
  );
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

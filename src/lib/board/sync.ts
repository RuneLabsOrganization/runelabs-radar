import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { benchmarkSnapshots, boardEntries, boardProposals, stories } from '../db/schema';
import { config } from '../config';
import { DOMAINS, DOMAIN_LABELS, type Domain } from '../domains';
import { SEED_BOARD_TASKS } from '../db/seed-data';
import { chatJSON } from '../llm/minimax';

const AA_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';
const AIDER_URL =
  'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml';
const SNAPSHOT_MAX_CHARS = 100_000;
const PROMPT_SNAPSHOT_BUDGET = 8_000;
const FETCH_TIMEOUT_MS = 20_000;

let _fetch: typeof fetch = fetch;
/** Test hook: replace fetch. */
export function _setFetch(f: typeof fetch): void {
  _fetch = f;
}

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await _fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function storeSnapshot(source: string, raw: string): void {
  getDb()
    .insert(benchmarkSnapshots)
    .values({ source, raw: raw.slice(0, SNAPSHOT_MAX_CHARS), fetchedAt: new Date() })
    .run();
}

function asOptString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Asks MiniMax for board proposals for one domain and inserts the accepted
 * ones as pending board_proposals. Returns how many were inserted.
 */
async function proposeForDomain(
  domain: Domain,
  snapshotText: string,
  storiesText: string,
  hasBenchmarks: boolean,
): Promise<number> {
  const db = getDb();
  const entries = db.select().from(boardEntries).where(eq(boardEntries.domain, domain)).all();
  const validTasks = entries.length > 0 ? entries.map((e) => e.task) : [...SEED_BOARD_TASKS[domain]];
  const currentText =
    entries.length > 0
      ? entries
          .map(
            (e) =>
              `- ${e.task}: bestOverall=${e.bestOverall ?? '(unset)'}, bestValue=${e.bestValue ?? '(unset)'}, ` +
              `cheapestViable=${e.cheapestViable ?? '(unset)'}, costNote=${e.costNote ?? '(unset)'}`,
          )
          .join('\n')
      : '(no current board entries — propose initial values)';

  const system =
    'You are the model-selection analyst for Runelabs, a vibecoding startup farm that ships small ' +
    'AI products fast across six domains: coding (code generation and coding agents), copy ' +
    '(marketing and long-form writing), image (image generation), video (video generation), ads ' +
    '(ad creative and campaign automation), and agentic (autonomous agents, browser/computer use). ' +
    'You maintain the per-domain "Best Right Now" cost-benefit board: for each task you recommend ' +
    'the best overall model/tool, the best value pick, and the cheapest still-viable option, with a ' +
    'one-line cost note. Favor practical cost-effectiveness over hype, and only change a ' +
    'recommendation when the evidence supports it.\n' +
    'Respond ONLY with a JSON object of this exact shape:\n' +
    '{"proposals":[{"task":"...","bestOverall":"...","bestValue":"...","cheapestViable":"...","costNote":"...","rationale":"..."}]}\n' +
    'Rules: "task" MUST be exactly one of the allowed tasks the user lists; at most one proposal ' +
    'per task; only include a task when you have a concrete, defensible recommendation; ' +
    '"rationale" must cite the benchmark data or news evidence you relied on.';

  const user =
    `Domain: ${domain} (${DOMAIN_LABELS[domain]})\n` +
    `Allowed tasks: ${validTasks.join(', ')}\n\n` +
    `Current board entries:\n${currentText}\n\n` +
    `Benchmark snapshots (may be truncated):\n${
      snapshotText ||
      '(no benchmark data available — derive proposals from the news below and make that clear in the rationale)'
    }\n\n` +
    `Top curated stories from the last 7 days:\n${storiesText}`;

  const res = await chatJSON<{ proposals?: unknown[] }>(system, user);
  const list = Array.isArray(res.proposals) ? res.proposals : [];

  let inserted = 0;
  for (const p of list) {
    if (typeof p !== 'object' || p === null) continue;
    const rec = p as Record<string, unknown>;
    const task = asOptString(rec.task);
    if (!task || !validTasks.includes(task)) continue;
    const proposed = {
      bestOverall: asOptString(rec.bestOverall),
      bestValue: asOptString(rec.bestValue),
      cheapestViable: asOptString(rec.cheapestViable),
      costNote: asOptString(rec.costNote),
    };
    if (!proposed.bestOverall && !proposed.bestValue && !proposed.cheapestViable && !proposed.costNote) {
      continue; // nothing actually proposed
    }
    const rationale = asOptString(rec.rationale) ?? 'No rationale provided.';
    db.insert(boardProposals)
      .values({
        domain,
        task,
        proposed: JSON.stringify(proposed),
        rationale: hasBenchmarks ? rationale : `[news-derived] ${rationale}`,
        status: 'pending',
        createdAt: new Date(),
      })
      .run();
    inserted++;
  }
  return inserted;
}

/**
 * Weekly board sync: pull benchmark snapshots (Artificial Analysis + aider
 * leaderboard, each best-effort), then draft pending board proposals per
 * domain from snapshots + the week's top stories + the current board.
 */
export async function runBoardSync(): Promise<{ snapshots: number; proposals: number }> {
  const db = getDb();
  let snapshots = 0;

  if (config.aaApiKey) {
    try {
      const raw = await fetchText(AA_URL, { 'x-api-key': config.aaApiKey });
      storeSnapshot('artificial-analysis', raw);
      snapshots++;
    } catch (e) {
      console.error('[board] Artificial Analysis fetch failed:', e);
    }
  }
  try {
    const raw = await fetchText(AIDER_URL);
    storeSnapshot('aider-polyglot', raw);
    snapshots++;
  } catch (e) {
    console.error('[board] aider leaderboard fetch failed:', e);
  }

  // Latest snapshot per source (includes earlier weeks when this run's fetches failed).
  const allSnaps = db
    .select()
    .from(benchmarkSnapshots)
    .orderBy(desc(benchmarkSnapshots.fetchedAt), desc(benchmarkSnapshots.id))
    .all();
  const latestBySource = new Map<string, string>();
  for (const s of allSnaps) {
    if (!latestBySource.has(s.source)) latestBySource.set(s.source, s.raw);
  }
  const hasBenchmarks = latestBySource.size > 0;
  const perSource = Math.floor(PROMPT_SNAPSHOT_BUDGET / Math.max(1, latestBySource.size));
  const snapshotText = Array.from(latestBySource.entries())
    .map(([source, raw]) => `--- ${source} ---\n${raw.slice(0, perSource)}`)
    .join('\n\n');

  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const topStories = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, weekAgo)))
    .orderBy(desc(stories.topScore))
    .limit(15)
    .all();
  const storiesText =
    topStories.map((s) => `- ${s.title}${s.tldr ? ` — ${s.tldr}` : ''}`).join('\n') ||
    '(no curated stories this week)';

  let proposals = 0;
  for (const domain of DOMAINS) {
    try {
      proposals += await proposeForDomain(domain, snapshotText, storiesText, hasBenchmarks);
    } catch (e) {
      console.error(`[board] proposal generation failed for domain "${domain}":`, e);
    }
  }
  return { snapshots, proposals };
}

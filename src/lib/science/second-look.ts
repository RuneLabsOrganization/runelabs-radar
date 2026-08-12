import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { stories } from '../db/schema';
import { getIdentity } from '../identity';
import { chatJSON, LlmError } from '../llm/minimax';

/** Only top-signal stories earn a second look. */
const MIN_SCORE = 70;
/** Stories stay eligible for 48h after curation. */
const WINDOW_MS = 48 * 36e5;
/** One batched LLM call per run, at most this many stories per batch. */
const BATCH = 5;

interface SecondLookItem {
  id: number;
  second_look: string;
}

/** Sanitize one LLM result row: numeric id, 20-500 chars of actual text. */
export function sanitizeSecondLooks(v: unknown, eligibleIds: Set<number>): SecondLookItem[] {
  if (!Array.isArray(v)) return [];
  const out: SecondLookItem[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    const id = Number(rec.id);
    const text = typeof rec.second_look === 'string' ? rec.second_look.trim() : '';
    if (!Number.isInteger(id) || !eligibleIds.has(id)) continue;
    if (text.length < 20) continue;
    out.push({ id, second_look: text.slice(0, 500) });
  }
  return out;
}

/**
 * Contrarian "second look" — for each top story, the strongest reason it
 * might NOT matter plus one second-order effect everyone misses. The counter
 * weight to the front-door score: keeps the briefing honest.
 *
 * Runs daily after the brief; ONE batched chatJSON call per run (cap-friendly).
 * Cap/outage (non-retryable LlmError) ends the run quietly — second looks are
 * optional garnish, never worth burning the day's budget.
 */
export async function runSecondLook(): Promise<{ considered: number; written: number }> {
  const db = getDb();
  const candidates = db
    .select({
      id: stories.id,
      title: stories.title,
      tldr: stories.tldr,
      whyItMatters: stories.whyItMatters,
      topScore: stories.topScore,
    })
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        gte(stories.topScore, MIN_SCORE),
        gte(stories.createdAt, new Date(Date.now() - WINDOW_MS)),
        isNull(stories.secondLook),
      ),
    )
    .orderBy(desc(stories.topScore))
    .limit(BATCH)
    .all();

  if (candidates.length === 0) return { considered: 0, written: 0 };

  const id = getIdentity();
  const system =
    `You are the resident skeptic for ${id.brandContext}. For each story below, write a ` +
    '"second look": 2-3 sentences giving the strongest concrete reason this story might NOT ' +
    'matter as much as it seems (hype cycle, cherry-picked benchmarks, incumbent lock-in, ' +
    'cost reality), plus ONE second-order effect the coverage is missing. Be specific — name ' +
    'the mechanism, not generic "time will tell" hedging. ' +
    'Respond ONLY with JSON: {"results":[{"id":<story id>,"second_look":"..."}]}';

  const user = candidates
    .map(
      (s) =>
        `[id ${s.id}] [score ${s.topScore}] ${s.title}\n` +
        `TLDR: ${s.tldr ?? '(none)'}\nWhy it matters: ${s.whyItMatters ?? '(none)'}`,
    )
    .join('\n\n');

  let results: SecondLookItem[];
  try {
    const res = await chatJSON<{ results?: unknown }>(system, user);
    results = sanitizeSecondLooks(res.results, new Set(candidates.map((c) => c.id)));
  } catch (e) {
    if (e instanceof LlmError) return { considered: candidates.length, written: 0 };
    throw e;
  }

  const now = new Date();
  for (const r of results) {
    db.update(stories)
      .set({ secondLook: r.second_look, secondLookAt: now })
      .where(eq(stories.id, r.id))
      .run();
  }
  return { considered: candidates.length, written: results.length };
}

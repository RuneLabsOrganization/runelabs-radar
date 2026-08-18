import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { items, patterns, stories } from '../db/schema';
import { chatJSON, drainLlmUsageStats, LlmError } from '../llm/minimax';
import { promptLine } from '../prompt-hygiene';
import { buildCurationPrompts, curationScores, type CurationResponse } from './curate';

const SAMPLE_SIZE = 20;
/** Rubric bar: 40+ means "relevant — teams should take a look", i.e. the gate shouldn't have killed it. */
const FALSE_KILL_MIN = 40;

export type GateAuditStats = {
  sampled: number;
  falseKills: number;
  falseKillRate: number;
  promptTokens: number;
  completionTokens: number;
};

/**
 * Weekly gate audit: re-score a random sample of 'filtered' stories with the
 * full curation prompt (gate bypassed) and count how many should have passed.
 * The verdict lands in `patterns` (kind 'gate-audit') so the false-kill rate
 * is visible on the hub — a terminal filter nobody audits is a blind spot.
 */
export async function runGateAudit(): Promise<GateAuditStats> {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const pool = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'filtered'), gte(stories.createdAt, weekAgo)))
    .orderBy(sql`RANDOM()`)
    .limit(SAMPLE_SIZE)
    .all();

  if (pool.length === 0) {
    return { sampled: 0, falseKills: 0, falseKillRate: 0, ...drainLlmUsageStats() };
  }

  let falseKills = 0;
  const misses: { score: number; title: string }[] = [];
  for (const story of pool) {
    const memberItems = db
      .select({ title: items.title, excerpt: items.excerpt })
      .from(items)
      .where(eq(items.storyId, story.id))
      .limit(5)
      .all();
    const { system, user } = buildCurationPrompts(story, memberItems, [], []);
    try {
      const res = await chatJSON<CurationResponse>(system, user);
      const { topScore } = curationScores(res);
      if (topScore >= FALSE_KILL_MIN) {
        falseKills++;
        misses.push({ score: topScore, title: story.title });
      }
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      if (!e.retryable) break; // daily cap — report the partial sample
    }
  }

  const falseKillRate = Math.round((falseKills / pool.length) * 100);
  const verdict =
    falseKills === 0
      ? 'Clean: every sampled filtered story was correctly dropped.'
      : `${falseKills} of ${pool.length} sampled filtered stories score ≥${FALSE_KILL_MIN} when the LLM sees them.`;
  db.insert(patterns)
    .values({
      kind: 'gate-audit',
      subject: null,
      headline: `Gate audit: ${falseKills}/${pool.length} filtered stories should have passed`,
      detail:
        misses.length === 0
          ? verdict
          : `${verdict} ${misses.map((m) => `[${m.score}] ${promptLine(m.title, 120)}`).join(' · ')}`.slice(0, 1000),
      score: falseKillRate,
      evidence: '[]',
      date: new Date().toISOString().slice(0, 10),
      createdAt: new Date(),
    })
    .run();

  return { sampled: pool.length, falseKills, falseKillRate, ...drainLlmUsageStats() };
}

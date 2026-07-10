import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { boardHistory, briefs, stories } from '../db/schema';
import { chatJSON, LlmError } from '../llm/minimax';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function upsertBrief(date: string, markdown: string): void {
  const now = new Date();
  getDb()
    .insert(briefs)
    .values({ date, markdown, createdAt: now })
    .onConflictDoUpdate({ target: briefs.date, set: { markdown, createdAt: now } })
    .run();
}

function quietDayMarkdown(date: string, historyLines: string[]): string {
  const changes =
    historyLines.length > 0
      ? `\n\n## Board changes (last 7 days)\n\n${historyLines.map((l) => `- ${l}`).join('\n')}`
      : '';
  return (
    `# Runelabs Morning Brief — ${date}\n\n` +
    'Quiet day: fewer than 3 curated stories in the last 24 hours. Nothing major to report.' +
    changes
  );
}

/**
 * Daily brief: top 10 curated stories of the last 24h + board changes of the
 * last 7 days → one MiniMax call → upsert briefs[today]. With fewer than 3
 * stories a static "quiet day" brief is written without touching the LLM.
 * Returns {wrote:false} only when the LLM call failed (logged, non-fatal).
 */
export async function runBrief(): Promise<{ wrote: boolean }> {
  const db = getDb();
  const date = todayStr();
  const dayAgo = new Date(Date.now() - 864e5);
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const topStories = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, dayAgo)))
    .orderBy(desc(stories.topScore))
    .limit(10)
    .all();

  const history = db
    .select()
    .from(boardHistory)
    .where(gte(boardHistory.appliedAt, weekAgo))
    .orderBy(desc(boardHistory.appliedAt))
    .all();
  const historyLines = history.map(
    (h) => `${h.appliedAt.toISOString().slice(0, 10)} ${h.domain}/${h.task}: ${h.change}`,
  );

  if (topStories.length < 3) {
    upsertBrief(date, quietDayMarkdown(date, historyLines));
    return { wrote: true };
  }

  const storiesText = topStories
    .map(
      (s, i) =>
        `${i + 1}. [score ${s.topScore}] ${s.title}\n` +
        `   TLDR: ${s.tldr ?? '(none)'}\n` +
        `   Why it matters: ${s.whyItMatters ?? '(none)'}`,
    )
    .join('\n');

  const system =
    'You write the internal morning brief for Runelabs, a vibecoding startup farm that ships small ' +
    'AI products fast across six domains: coding, copy (marketing writing), image generation, ' +
    'video generation, ads, and agentic automation. Write a concise markdown brief that starts ' +
    `with the H1 title "# Runelabs Morning Brief — ${todayStr()}" and has three sections: ` +
    '"## What happened" (the top stories, grouped where sensible), "## Why it matters for ' +
    'Runelabs" (concrete implications for what the team builds), and "## Board changes" ' +
    '(summarize the recent Best-Right-Now board changes, or state there were none). Keep it ' +
    'tight and factual — a tool, not a newsletter.\n' +
    'Respond ONLY with a JSON object of this exact shape: {"markdown":"..."}';

  const user =
    `Date: ${date}\n\n` +
    `Top curated stories from the last 24 hours:\n${storiesText}\n\n` +
    `Board changes in the last 7 days:\n${
      historyLines.length > 0 ? historyLines.map((l) => `- ${l}`).join('\n') : '(none)'
    }`;

  try {
    const res = await chatJSON<{ markdown?: unknown }>(system, user);
    const markdown = typeof res.markdown === 'string' ? res.markdown.trim() : '';
    if (!markdown) throw new LlmError('Brief response missing "markdown"', false);
    upsertBrief(date, markdown);
    return { wrote: true };
  } catch (e) {
    console.error('[brief] LLM brief generation failed:', e);
    return { wrote: false };
  }
}

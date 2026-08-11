import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { boardHistory, briefs, domainDigests, insights, stories } from '../db/schema';
import { DOMAINS, type Domain } from '../domains';
import { getIdentity } from '../identity';
import { chatJSON, LlmError } from '../llm/minimax';

interface InsightItem {
  headline: string;
  detail: string;
  direction: 'up' | 'down' | 'watch';
  domain?: Domain;
}

/** Sanitizes the LLM's insights array: 1-5 items, valid directions/domains. */
export function sanitizeInsights(v: unknown): InsightItem[] {
  if (!Array.isArray(v)) return [];
  const out: InsightItem[] = [];
  for (const raw of v) {
    if (out.length >= 5) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.headline !== 'string' || typeof rec.detail !== 'string') continue;
    const headline = rec.headline.trim().slice(0, 120);
    const detail = rec.detail.trim().slice(0, 400);
    if (!headline || !detail) continue;
    const direction =
      rec.direction === 'up' || rec.direction === 'down' || rec.direction === 'watch'
        ? rec.direction
        : 'watch';
    const domain =
      typeof rec.domain === 'string' && (DOMAINS as readonly string[]).includes(rec.domain)
        ? (rec.domain as Domain)
        : undefined;
    out.push({ headline, detail, direction, ...(domain ? { domain } : {}) });
  }
  return out;
}

function upsertInsights(date: string, items: InsightItem[]): void {
  if (items.length === 0) return;
  const now = new Date();
  getDb()
    .insert(insights)
    .values({ date, items: JSON.stringify(items), createdAt: now })
    .onConflictDoUpdate({ target: insights.date, set: { items: JSON.stringify(items), createdAt: now } })
    .run();
}

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
    `# ${getIdentity().briefTitle} — ${date}\n\n` +
    'Quiet day: fewer than 3 curated stories in the last 24 hours. Nothing major to report.' +
    changes
  );
}

/**
 * Daily brief: top curated stories of the last 24h + board changes of the
 * last 7 days → one MiniMax call → upsert briefs[today] plus the day's
 * analyst-note insights. With fewer than 3 stories a static "quiet day" brief
 * is written without touching the LLM (insights left as-is).
 * Returns {wrote:false} only when the LLM call failed (logged, non-fatal).
 */
export async function runBrief(): Promise<{ wrote: boolean; insights: number; digests: number }> {
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
    return { wrote: true, insights: 0, digests: 0 };
  }

  const storiesText = topStories
    .map(
      (s, i) =>
        `${i + 1}. [score ${s.topScore}] ${s.title}\n` +
        `   TLDR: ${s.tldr ?? '(none)'}\n` +
        `   Why it matters: ${s.whyItMatters ?? '(none)'}`,
    )
    .join('\n');

  const id = getIdentity();
  const system =
    `You write the internal morning brief for ${id.brandContext}. Write a concise markdown brief that starts ` +
    `with the H1 title "# ${id.briefTitle} — ${todayStr()}" and has three sections: ` +
    '"## What happened" (the top stories, grouped where sensible), "## Why it matters for ' +
    `${id.brandName}" (concrete implications for what the team builds), and "## Board changes" ` +
    '(summarize the recent Best-Right-Now board changes, or state there were none). Keep it ' +
    'tight and factual — a tool, not a newsletter.\n' +
    'Additionally produce "insights": 3-5 analyst notes that go BEYOND summarizing — trends, ' +
    `shifts and calls to action a sharp analyst would flag for ${id.brandName}. Each is ` +
    '{"headline": punchy claim (max ~12 words), "detail": 1-2 sentences of evidence/implication, ' +
    '"direction": "up" (rising, act on it) | "down" (fading, deprioritize) | "watch" (developing), ' +
    '"domain": optionally one of coding|copy|image|video|ads|agentic}.\n' +
    'Respond ONLY with a JSON object of this exact shape: ' +
    '{"markdown":"...","insights":[{"headline":"...","detail":"...","direction":"...","domain":"..."}]}';

  const user =
    `Date: ${date}\n\n` +
    `Top curated stories from the last 24 hours:\n${storiesText}\n\n` +
    `Board changes in the last 7 days:\n${
      historyLines.length > 0 ? historyLines.map((l) => `- ${l}`).join('\n') : '(none)'
    }`;

  try {
    const res = await chatJSON<{ markdown?: unknown; insights?: unknown }>(system, user);
    const markdown = typeof res.markdown === 'string' ? res.markdown.trim() : '';
    if (!markdown) throw new LlmError('Brief response missing "markdown"', false);
    upsertBrief(date, markdown);
    const items = sanitizeInsights(res.insights);
    upsertInsights(date, items);
    const digests = await writeDomainDigests(date);
    return { wrote: true, insights: items.length, digests };
  } catch (e) {
    console.error('[brief] LLM brief generation failed:', e);
    return { wrote: false, insights: 0, digests: 0 };
  }
}

/**
 * Per-domain 2-line analytical digests from the last 72h of curated stories.
 * One extra LLM call per day; skipped when the daily cap is already hit
 * (LlmError non-retryable) — the main brief always has priority.
 */
async function writeDomainDigests(date: string): Promise<number> {
  const db = getDb();
  const windowStart = new Date(Date.now() - 72 * 36e5);
  const recent = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, windowStart)))
    .orderBy(desc(stories.topScore))
    .limit(100)
    .all();

  const byDomain = new Map<Domain, { title: string; tldr: string | null; score: number }[]>();
  for (const s of recent) {
    let scores: Partial<Record<Domain, number>> = {};
    try {
      scores = JSON.parse(s.domainScores ?? '{}') as Partial<Record<Domain, number>>;
    } catch {
      continue;
    }
    for (const d of DOMAINS) {
      if ((scores[d] ?? 0) >= 40) {
        const list = byDomain.get(d) ?? [];
        if (list.length < 5) list.push({ title: s.title, tldr: s.tldr, score: scores[d]! });
        byDomain.set(d, list);
      }
    }
  }

  const userText = DOMAINS.map((d) => {
    const list = byDomain.get(d) ?? [];
    const lines = list.length
      ? list.map((s) => `- [${s.score}] ${s.title}${s.tldr ? ` — ${s.tldr}` : ''}`).join('\n')
      : '(no signals)';
    return `### ${d}\n${lines}`;
  }).join('\n\n');

  const system =
    `You write sector digests for ${getIdentity().brandContext}. For each domain, write ONE ` +
    'analytical line (max 240 chars) about the last 72h: the direction, not a summary — what ' +
    'shifted, what a builder should do about it. Domains with no signals get an empty string. ' +
    'Respond ONLY with JSON: {"coding":"...","copy":"...","image":"...","video":"...","ads":"...","agentic":"..."}';

  let res: Record<string, unknown>;
  try {
    res = await chatJSON<Record<string, unknown>>(system, userText);
  } catch (e) {
    if (e instanceof LlmError) return 0; // cap/outage — digests are optional
    throw e;
  }

  let written = 0;
  for (const d of DOMAINS) {
    const text = typeof res[d] === 'string' ? (res[d] as string).trim().slice(0, 280) : '';
    if (!text) continue;
    db.insert(domainDigests)
      .values({ domain: d, date, text, createdAt: new Date() })
      .onConflictDoUpdate({ target: [domainDigests.domain, domainDigests.date], set: { text } })
      .run();
    written++;
  }
  return written;
}

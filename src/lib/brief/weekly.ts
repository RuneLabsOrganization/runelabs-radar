import { and, desc, eq, gte, notLike, sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  boardHistory,
  launches,
  metricPoints,
  opportunities,
  patterns,
  reports,
  stories,
} from '../db/schema';
import { getIdentity } from '../identity';
import { chatJSON, drainLlmUsageStats, LlmError } from '../llm/minimax';
import { utcDay } from '../metrics';
import { promptLine, stripCjkDeep } from '../prompt-hygiene';

/** YYYY-MM-DD (UTC) of the Sunday opening the current week (today when it IS Sunday). */
export function weekSunday(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function upsertReport(date: string, markdown: string): void {
  const now = new Date();
  getDb()
    .insert(reports)
    .values({ date, markdown, createdAt: now })
    .onConflictDoUpdate({ target: reports.date, set: { markdown, createdAt: now } })
    .run();
}

interface Mover {
  source: string;
  entity: string;
  metric: string;
  from: number;
  to: number;
  pct: number;
}

/**
 * Biggest first-party series moves over the last 7 days: for each
 * (source, entity, metric), latest in-window value vs the last baseline
 * point before the window (earliest in-window when no baseline exists).
 * AA-derived series are never eligible (same `notLike source 'aa%'` rule as
 * the public dump) — republication terms apply to the report too.
 */
function marketMovers(sinceDay: string, limit = 8): Mover[] {
  const db = getDb();
  // 14d lookback so each series has a pre-window baseline point
  const rows = db
    .select({
      source: metricPoints.source,
      entity: metricPoints.entity,
      metric: metricPoints.metric,
      value: metricPoints.value,
      date: metricPoints.date,
    })
    .from(metricPoints)
    .where(and(notLike(metricPoints.source, 'aa%'), gte(metricPoints.date, utcDay(new Date(Date.now() - 14 * 864e5)))))
    .orderBy(metricPoints.date)
    .all();

  const series = new Map<string, { source: string; entity: string; metric: string; pts: { date: string; value: number }[] }>();
  for (const r of rows) {
    const key = `${r.source}${r.entity}${r.metric}`;
    const s = series.get(key) ?? { source: r.source, entity: r.entity, metric: r.metric, pts: [] };
    s.pts.push({ date: r.date, value: r.value });
    series.set(key, s);
  }

  const movers: Mover[] = [];
  for (const s of series.values()) {
    const inWindow = s.pts.filter((p) => p.date >= sinceDay);
    if (inWindow.length === 0) continue;
    const before = s.pts.filter((p) => p.date < sinceDay);
    const base = before.length > 0 ? before[before.length - 1]! : inWindow[0]!;
    const last = inWindow[inWindow.length - 1]!;
    if (base.value === 0 || base.date === last.date) continue;
    const pct = ((last.value - base.value) / Math.abs(base.value)) * 100;
    if (Math.abs(pct) < 10) continue; // noise floor — movers only
    movers.push({ source: s.source, entity: s.entity, metric: s.metric, from: base.value, to: last.value, pct });
  }
  return movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, limit);
}

/** Static issue when the week had no material input at all — no LLM call. */
function quietWeekMarkdown(date: string): string {
  return (
    `# State of the Builder Market — week of ${date}\n\n` +
    'Quiet week: no curated stories, board changes, launches, anomalies or market moves crossed ' +
    'the radar in the last 7 days. The archive resumes when the signals do.'
  );
}

/**
 * Weekly "State of the Builder Market" issue (Sunday 08:00 cron): the week's
 * top stories, board changes, pursue-verdict opportunities, launch counts by
 * category, pattern anomalies and first-party market movers → ONE MiniMax
 * call → upsert reports[this-Sunday]. Re-running the same Sunday overwrites.
 * On LLM failure nothing is written and words is 0 (logged, non-fatal).
 */
export async function runWeeklyReport(): Promise<{
  date: string;
  words: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}> {
  const db = getDb();
  const date = weekSunday();
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const sinceDay = utcDay(weekAgo);

  const topStories = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, weekAgo)))
    .orderBy(desc(stories.topScore))
    .limit(12)
    .all();

  const history = db
    .select()
    .from(boardHistory)
    .where(gte(boardHistory.appliedAt, weekAgo))
    .orderBy(desc(boardHistory.appliedAt))
    .all();

  const pursue = db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.verdict, 'pursue'), eq(opportunities.status, 'active')))
    .orderBy(desc(opportunities.flipScore))
    .limit(8)
    .all();

  const launchCounts = db
    .select({ category: launches.category, n: sql<number>`count(*)` })
    .from(launches)
    .where(gte(launches.launchedAt, weekAgo))
    .groupBy(launches.category)
    .all()
    .sort((a, b) => b.n - a.n);

  const anomalies = db
    .select()
    .from(patterns)
    .where(gte(patterns.createdAt, weekAgo))
    .orderBy(desc(patterns.score))
    .limit(8)
    .all();

  const movers = marketMovers(sinceDay);

  const empty =
    topStories.length === 0 &&
    history.length === 0 &&
    pursue.length === 0 &&
    launchCounts.length === 0 &&
    anomalies.length === 0 &&
    movers.length === 0;
  if (empty) {
    const markdown = quietWeekMarkdown(date);
    upsertReport(date, markdown);
    return { date, words: markdown.split(/\s+/).length, ...drainLlmUsageStats() };
  }

  // titles/headlines are scraped or derived from scraped text — all of it
  // gets prompt-line hygiene before interpolation
  const storiesText = topStories
    .map(
      (s, i) =>
        `${i + 1}. [score ${s.topScore}] ${promptLine(s.title, 160)}\n` +
        `   TLDR: ${promptLine(s.tldr ?? '(none)', 300)}`,
    )
    .join('\n');

  const historyLines = history.map(
    (h) => `- ${h.appliedAt.toISOString().slice(0, 10)} ${promptLine(h.domain, 20)}/${promptLine(h.task, 60)}: ${promptLine(h.change, 200)}`,
  );

  const pursueText = pursue
    .map((o) => {
      const isNew = o.firstSeenAt >= weekAgo ? ' [new this week]' : '';
      return `- [flip ${o.flipScore}/hold ${o.holdScore}]${isNew} ${promptLine(o.title, 120)} — ${promptLine(o.thesis, 240)}`;
    })
    .join('\n');

  const launchText = launchCounts
    .map((l) => `- ${promptLine(l.category ?? 'uncategorized', 40)}: ${l.n}`)
    .join('\n');

  const anomalyText = anomalies
    .map((p) => `- [${promptLine(p.kind, 30)}] ${promptLine(p.headline, 160)} — ${promptLine(p.detail, 240)}`)
    .join('\n');

  const moverText = movers
    .map(
      (m) =>
        `- ${promptLine(m.entity, 60)} · ${promptLine(m.metric, 40)} (${promptLine(m.source, 30)}): ` +
        `${m.from} → ${m.to} (${m.pct >= 0 ? '+' : ''}${Math.round(m.pct)}%)`,
    )
    .join('\n');

  const id = getIdentity();
  const system =
    `You write the weekly "State of the Builder Market" report for ${id.brandContext}. ` +
    `Start with the H1 "# State of the Builder Market — week of ${date}" and write a tight, ` +
    'factual markdown issue — a tool, not a newsletter — with these sections, in this order ' +
    '(omit a section entirely when its input says none): "## The week in signals" (the top ' +
    'stories, grouped where sensible), "## Board moves" (Best-Right-Now board changes and what ' +
    'they imply), "## Opportunities" (pursue-verdict openings; flag the ones new this week), ' +
    '"## Launch pulse" (what builders shipped, from the category counts), "## Anomalies" ' +
    '(what the machine caught — one line each, why it matters), "## Market movers" (the ' +
    'first-party series that moved most; direction over magnitude). No filler, no hype. ' +
    'Respond ONLY with a JSON object of this exact shape: {"markdown":"..."}';

  const user =
    `Week ending: ${date}\n\n` +
    `Top curated stories (7d):\n${storiesText || '(none)'}\n\n` +
    `Board changes (7d):\n${historyLines.length > 0 ? historyLines.join('\n') : '(none)'}\n\n` +
    `Pursue-verdict opportunities:\n${pursueText || '(none)'}\n\n` +
    `Launches by category (7d):\n${launchText || '(none)'}\n\n` +
    `Pattern anomalies (7d):\n${anomalyText || '(none)'}\n\n` +
    `Market movers (7d, first-party series only):\n${moverText || '(none)'}`;

  try {
    const res = stripCjkDeep(await chatJSON<{ markdown?: unknown }>(system, user, { feature: 'weekly-report' }));
    const markdown = typeof res.markdown === 'string' ? res.markdown.trim() : '';
    if (!markdown) throw new LlmError('Weekly report response missing "markdown"', false);
    upsertReport(date, markdown);
    return { date, words: markdown.split(/\s+/).length, ...drainLlmUsageStats() };
  } catch (e) {
    console.error('[weekly-report] LLM issue generation failed:', e);
    return { date, words: 0, ...drainLlmUsageStats() };
  }
}

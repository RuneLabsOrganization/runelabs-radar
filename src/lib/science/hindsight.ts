import { and, desc, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { launches, stories, votes } from '../db/schema';
import { titleSimilarity } from '../curate/cluster';
import { recordForecast } from './accuracy';

/** Stories enter the hindsight window at 36h and leave at 60h. */
const MIN_AGE_MS = 36 * 36e5;
const MAX_AGE_MS = 60 * 36e5;

/**
 * Hindsight scoring — no LLM, observed signals only. Answers "did this story
 * actually matter?" two days after curation, which calibrates the front-door
 * top_score and powers the public accuracy page.
 *
 * Weights (heuristic v1, documented honestly):
 *   entity echo      up to 30 — other stories later mention the same entities
 *   launch            flat 25 — a tracked launch (Show HN / ProductHunt) shares
 *                     an entity with the story (the news materialized)
 *   follow-through   up to 25 — later stories are developments of this one
 *                     (Jaccard 0.3-0.55: same topic, not a dupe)
 *   team votes       ±15 — net human votes (up - down) × 5
 */
export function hindsightScore(story: {
  id: number;
  title: string;
  entities: string | null;
  createdAt: Date;
}): number {
  const db = getDb();

  let names: string[] = [];
  try {
    names = (JSON.parse(story.entities ?? '[]') as { name: string }[]).map((e) => e.name.toLowerCase());
  } catch {
    /* no entities */
  }

  const later = db
    .select({ id: stories.id, title: stories.title, entities: stories.entities })
    .from(stories)
    .where(and(gte(stories.createdAt, story.createdAt), ne(stories.id, story.id)))
    .all();

  // entity echo: distinct later stories sharing ≥1 entity
  let echoStories = 0;
  let followThrough = 0;
  for (const s of later) {
    if (names.length > 0) {
      try {
        const other = (JSON.parse(s.entities ?? '[]') as { name: string }[]).map((e) => e.name.toLowerCase());
        if (other.some((n) => names.includes(n))) echoStories++;
      } catch {
        /* skip */
      }
    }
    const sim = titleSimilarity(story.title, s.title);
    if (sim >= 0.3 && sim < 0.55) followThrough++;
  }

  // launch materialization: a launch sharing an entity, after the story
  let materialized = 0;
  if (names.length > 0) {
    const rows = db
      .select({ title: launches.title })
      .from(launches)
      .where(gte(launches.launchedAt, story.createdAt))
      .all();
    materialized = rows.some((r) => names.some((n) => n.length >= 3 && r.title.toLowerCase().includes(n))) ? 1 : 0;
  }

  const net =
    db
      .select({ value: votes.value })
      .from(votes)
      .where(eq(votes.storyId, story.id))
      .all()
      .reduce((acc, v) => acc + v.value, 0) ?? 0;

  const score =
    Math.min(1, echoStories / 5) * 30 +
    materialized * 25 +
    Math.min(1, followThrough / 5) * 25 +
    Math.max(-15, Math.min(15, net * 5));

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Daily job: score curated stories that entered the 36-60h window and don't
 * have a hindsight value yet. Idempotent (skips scored rows).
 */
export async function runRescore(): Promise<{ scored: number }> {
  const db = getDb();
  const now = Date.now();
  const due = db
    .select()
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        isNull(stories.hindsight),
        lte(stories.createdAt, new Date(now - MIN_AGE_MS)),
        gte(stories.createdAt, new Date(now - MAX_AGE_MS)),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(120)
    .all();

  for (const s of due) {
    db.update(stories)
      .set({ hindsight: hindsightScore(s), hindsightAt: new Date() })
      .where(eq(stories.id, s.id))
      .run();
  }
  // same daily tick: persist today's forecast for later grading
  recordForecast();
  return { scored: due.length };
}

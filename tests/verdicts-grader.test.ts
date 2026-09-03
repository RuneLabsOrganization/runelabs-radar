import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, rawSqlite } from '@/lib/db';
import { kitPickHistory, stories } from '@/lib/db/schema';
import { runVerdictGrade } from '@/lib/science/verdicts';
import { useTestDb } from './helpers/db';

const DAY = 86_400_000;

function addHistory(over: { fromPick: string | null; toPick: string; reason: string; changedAt: Date }) {
  getDb()
    .insert(kitPickHistory)
    .values({ category: 'coding', task: 'agent', tier: 'best', ...over })
    .run();
}

function addStory(title: string, createdAt: Date) {
  getDb().insert(stories).values({ title, status: 'curated', topScore: 70, createdAt }).run();
}

describe('runVerdictGrade firstSeenAtNamed (bounded escaped LIKE)', () => {
  beforeEach(() => useTestDb());

  it('grades against the earliest curated story naming the replacement', async () => {
    const t0 = new Date(Date.now() - 100 * DAY);
    const t1 = new Date(Date.now() - 40 * DAY);
    addHistory({ fromPick: null, toPick: 'Tool A', reason: 'initial', changedAt: t0 });
    // the earliest mention predates the Tool A call → correction; a
    // latest-first lookup would wrongly read the recent story and say upgrade
    addStory('Tool B spotted in the wild', new Date(Date.now() - 130 * DAY));
    addStory('Tool B ships v2', new Date(Date.now() - 20 * DAY));
    addHistory({ fromPick: 'Tool A', toPick: 'Tool B', reason: 'Tool B is stronger', changedAt: t1 });

    await runVerdictGrade();

    const flip = getDb().select().from(kitPickHistory).all().find((r) => r.toPick === 'Tool B')!;
    expect(flip.changeKind).toBe('correction');
  });

  it('matches LIKE wildcards in tool names literally', async () => {
    const t0 = new Date(Date.now() - 100 * DAY);
    const t1 = new Date(Date.now() - 40 * DAY);
    addHistory({ fromPick: null, toPick: 'Tool A', reason: 'initial', changedAt: t0 });
    // "500 Tool" must NOT count as a sighting of "50% Tool" — an unescaped %
    // would match it and wrongly grade this flip a correction
    addStory('500 Tool enters beta', new Date(Date.now() - 120 * DAY));
    addStory('50% Tool launches', new Date(Date.now() - 60 * DAY)); // after the call
    addHistory({ fromPick: 'Tool A', toPick: '50% Tool', reason: '50% Tool is stronger', changedAt: t1 });

    await runVerdictGrade();

    const flip = getDb().select().from(kitPickHistory).all().find((r) => r.toPick === '50% Tool')!;
    expect(flip.changeKind).toBe('upgrade');
  });

  it('reads bounded: the lookup walks the (status, created_at) index with LIMIT 1', () => {
    // same WHERE/ORDER BY shape firstSeenAtNamed issues through drizzle
    const plan = rawSqlite(getDb())
      .prepare(
        `EXPLAIN QUERY PLAN SELECT created_at FROM stories
         WHERE status = 'curated' AND lower(title) LIKE '%tool b%' ESCAPE '\\'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .all() as { detail: string }[];
    expect(plan.map((r) => r.detail).join('\n')).toContain('stories_status_created');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { jobRuns } from '@/lib/db/schema';
import { jobHistory } from '@/lib/analytics';
import { useTestDb } from './helpers/db';

const DAY = 864e5;

function addRun(job: string, startedAt: Date, status: 'ok' | 'error' = 'ok') {
  getDb()
    .insert(jobRuns)
    .values({ job, startedAt, finishedAt: new Date(startedAt.getTime() + 60e3), status })
    .run();
}

describe('jobHistory bounded reads', () => {
  beforeEach(() => useTestDb());

  it('excludes runs older than 30 days', () => {
    addRun('curate', new Date(Date.now() - 45 * DAY));
    addRun('curate', new Date(Date.now() - 2 * DAY));

    const history = jobHistory();

    expect(history.curate).toHaveLength(1);
    expect(history.curate![0]!.startedAt.getTime()).toBeGreaterThan(Date.now() - 3 * DAY);
  });

  it('keeps the newest perJob runs per job, oldest → newest', () => {
    for (let i = 34; i >= 0; i--) addRun('brief', new Date(Date.now() - i * 60e3)); // 35 runs, 1 min apart

    const history = jobHistory();

    expect(history.brief).toHaveLength(28);
    const times = history.brief!.map((c) => c.startedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // the newest 28 are kept — the 7 oldest (28–34 min ago) dropped; started_at has second precision
    expect(Math.abs(times[0]! - (Date.now() - 27 * 60e3))).toBeLessThan(2000);
    expect(times.at(-1)!).toBeGreaterThan(Date.now() - 60e3);
  });

  it('still covers low-frequency jobs when a high-frequency job floods the window', () => {
    for (let i = 0; i < 60; i++) addRun('ingest', new Date(Date.now() - i * 30e3));
    addRun('gate-audit', new Date(Date.now() - 25 * DAY)); // infrequent, but inside the window

    const history = jobHistory();

    expect(history['gate-audit']).toHaveLength(1);
    expect(history.ingest!.length).toBeLessThanOrEqual(28);
  });
});

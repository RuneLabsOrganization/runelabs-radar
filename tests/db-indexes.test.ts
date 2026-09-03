import { describe, expect, it } from 'vitest';
import { useTestDb } from './helpers/db';
import { rawSqlite, type Db } from '@/lib/db';
import { jobRuns } from '@/lib/db/schema';

interface IndexRow {
  name: string;
  partial: number;
}

function indexList(db: Db, table: string): IndexRow[] {
  return rawSqlite(db).pragma(`index_list('${table}')`) as IndexRow[];
}

describe('query-driven indexes', () => {
  it('items has an index for the dominant fetched_at filter', () => {
    const db = useTestDb();
    const names = indexList(db, 'items').map((i) => i.name);
    expect(names).toContain('items_fetched_at');
    expect(names).toContain('items_story');
  });

  it('llm_calls has an index for per-user quota counts', () => {
    const db = useTestDb();
    const names = indexList(db, 'llm_calls').map((i) => i.name);
    expect(names).toContain('llm_calls_feature_user_ts');
    expect(names).toContain('llm_calls_ts');
    expect(names).toContain('llm_calls_feature_ts');
  });

  it('job_runs has a partial unique index on running rows', () => {
    const db = useTestDb();
    const idx = indexList(db, 'job_runs').find((i) => i.name === 'job_runs_running_unique');
    expect(idx).toBeDefined();
    expect(idx!.partial).toBe(1);
  });
});

describe('job_runs_running_unique', () => {
  function insertRun(db: Db, job: string, status: 'running' | 'ok' | 'error'): void {
    db.insert(jobRuns).values({ job, startedAt: new Date(), status }).run();
  }

  it('rejects a second running row for the same job', () => {
    const db = useTestDb();
    insertRun(db, 'ingest', 'running');
    expect(() => insertRun(db, 'ingest', 'running')).toThrow(/UNIQUE constraint failed/);
  });

  it('allows concurrent runs of different jobs', () => {
    const db = useTestDb();
    insertRun(db, 'ingest', 'running');
    insertRun(db, 'embed', 'running');
    expect(rawSqlite(db).prepare('SELECT count(*) c FROM job_runs').get()).toEqual({ c: 2 });
  });

  it('allows any number of finished rows per job', () => {
    const db = useTestDb();
    insertRun(db, 'ingest', 'ok');
    insertRun(db, 'ingest', 'error');
    insertRun(db, 'ingest', 'ok');
    insertRun(db, 'ingest', 'running');
    expect(rawSqlite(db).prepare('SELECT count(*) c FROM job_runs').get()).toEqual({ c: 4 });
  });
});

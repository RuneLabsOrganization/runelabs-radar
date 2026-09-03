import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from './helpers/db';
import { rawSqlite, type Db } from '@/lib/db';
import { stories } from '@/lib/db/schema';

function insertStory(db: Db, title: string): number {
  return db
    .insert(stories)
    .values({ title, tldr: 'generic tldr', whyItMatters: 'why', createdAt: new Date() })
    .returning({ id: stories.id })
    .get()!.id;
}

function docsize(db: Db): number {
  return (rawSqlite(db).prepare('SELECT count(*) c FROM stories_fts_docsize').get() as { c: number }).c;
}

function ftsRowids(db: Db, term: string): number[] {
  return rawSqlite(db)
    .prepare('SELECT rowid FROM stories_fts WHERE stories_fts MATCH ?')
    .all(term)
    .map((r) => (r as { rowid: number }).rowid);
}

describe('stories_fts_au trigger', () => {
  it('is created with a WHEN clause limited to searchable columns', () => {
    const db = useTestDb();
    const row = rawSqlite(db)
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'stories_fts_au'")
      .get() as { sql: string } | undefined;
    expect(row?.sql).toMatch(/WHEN/i);
    expect(row?.sql).toMatch(/old\.title IS NOT new\.title/i);
  });

  it('cluster remap updates leave the FTS index untouched', () => {
    const db = useTestDb();
    const id = insertStory(db, 'clusterstable');

    const before = docsize(db);
    db.update(stories).set({ clusterId: 7, mapX: 1.5, mapY: -2 }).where(eq(stories.id, id)).run();

    expect(docsize(db)).toBe(before);
    expect(ftsRowids(db, 'clusterstable')).toEqual([id]);
  });

  it('title updates still reindex the story', () => {
    const db = useTestDb();
    const id = insertStory(db, 'oldtokalpha');
    expect(ftsRowids(db, 'oldtokalpha')).toEqual([id]);

    db.update(stories).set({ title: 'newtokbeta' }).where(eq(stories.id, id)).run();

    expect(ftsRowids(db, 'newtokbeta')).toEqual([id]);
    expect(ftsRowids(db, 'oldtokalpha')).toEqual([]);
  });
});

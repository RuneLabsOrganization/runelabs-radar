import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

let _db: Db | null = null;

/** Open a database at the given location (':memory:' supported) and run migrations. */
export function openDb(location: string): Db {
  if (location !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
  }
  const sqlite = new Database(location);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  bootstrapFts(sqlite);
  return db;
}

/**
 * FTS5 search index over stories — outside drizzle migrations (virtual
 * tables aren't its territory). Idempotent and self-healing: safe at boot
 * on every process, rebuilds if the index ever drifts empty vs stories.
 */
function bootstrapFts(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS stories_fts USING fts5(
      title, tldr, why_it_matters,
      content='stories', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS stories_fts_ai AFTER INSERT ON stories BEGIN
      INSERT INTO stories_fts(rowid, title, tldr, why_it_matters)
      VALUES (new.id, new.title, new.tldr, new.why_it_matters);
    END;
    CREATE TRIGGER IF NOT EXISTS stories_fts_ad AFTER DELETE ON stories BEGIN
      INSERT INTO stories_fts(stories_fts, rowid, title, tldr, why_it_matters)
      VALUES ('delete', old.id, old.title, old.tldr, old.why_it_matters);
    END;
    CREATE TRIGGER IF NOT EXISTS stories_fts_au AFTER UPDATE ON stories BEGIN
      INSERT INTO stories_fts(stories_fts, rowid, title, tldr, why_it_matters)
      VALUES ('delete', old.id, old.title, old.tldr, old.why_it_matters);
      INSERT INTO stories_fts(rowid, title, tldr, why_it_matters)
      VALUES (new.id, new.title, new.tldr, new.why_it_matters);
    END;
  `);
  // first boot on an existing DB: backfill. NOTE: counting stories_fts reads
  // the CONTENT table (always full) — the real index size lives in docsize.
  const indexed = (sqlite.prepare('SELECT count(*) c FROM stories_fts_docsize').get() as { c: number }).c;
  const storyCount = (sqlite.prepare('SELECT count(*) c FROM stories').get() as { c: number }).c;
  if (storyCount > 0 && indexed === 0) {
    sqlite.exec(`INSERT INTO stories_fts(stories_fts) VALUES('rebuild')`);
  }
}

/** Process-wide singleton used by the app and worker. */
export function getDb(): Db {
  if (!_db) {
    _db = openDb(config.databasePath);
  }
  return _db;
}

/** Test hook: replace the singleton (e.g. with an in-memory db). */
export function _setDb(db: Db | null): void {
  _db = db;
}

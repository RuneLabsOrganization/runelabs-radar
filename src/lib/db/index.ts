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
  return db;
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
